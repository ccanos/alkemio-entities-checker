/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as ts from 'typescript';
import * as fs from 'fs';
import {
  TINY_TEXT_LENGTH,
  SMALL_TEXT_LENGTH,
  MID_TEXT_LENGTH,
  LONG_TEXT_LENGTH,
  VERY_LONG_TEXT_LENGTH,
  UUID_LENGTH,
  CANVAS_VALUE_LENGTH,
  LIFECYCLE_DEFINITION_LENGTH,
} from './common/constants';

interface DocEntry {
  name?: string;
  fileName?: string;
  documentation?: string;
  type?: string;
  value?: any;
  rawValue?: string;
  constructors?: DocEntry[];
  parameters?: DocEntry[];
  decorators?: DocEntry[];
  properties?: DocEntry[];
  returnType?: string;
}

const replacerFunc = () => {
  const visited = new WeakSet();
  return (_key: any, value: any) => {
    if (typeof value === 'object' && value !== null) {
      if (visited.has(value)) {
        return;
      }
      visited.add(value);
    }
    return value;
  };
};

const parseColLengthConst = function (s: string): number | string {
  switch (s) {
    case 'TINY_TEXT_LENGTH':
      return TINY_TEXT_LENGTH;
    case 'SMALL_TEXT_LENGTH':
      return SMALL_TEXT_LENGTH;
    case 'MID_TEXT_LENGTH':
      return MID_TEXT_LENGTH;
    case 'LONG_TEXT_LENGTH':
      return LONG_TEXT_LENGTH;
    case 'VERY_LONG_TEXT_LENGTH':
      return VERY_LONG_TEXT_LENGTH;
    case 'UUID_LENGTH':
      return UUID_LENGTH;
    case 'CANVAS_VALUE_LENGTH':
      return CANVAS_VALUE_LENGTH;
    case 'LIFECYCLE_DEFINITION_LENGTH':
      return LIFECYCLE_DEFINITION_LENGTH;
    default: {
      console.warn('Unable to parse const lenght:', s);
    }
  }
  return s;
};

/** Generate Json for all classes in a set of .ts files */
function generateJson(
  fileNames: string[],
  outputFile: string,
  options: ts.CompilerOptions
): void {
  // Build a program using the set of root file names in fileNames
  const program = ts.createProgram(
    fileNames.map(fileName => `${__dirname}/${fileName}`),
    options
  );

  // Get the checker, we will use it to find more about classes
  const checker = program.getTypeChecker();

  const output: DocEntry[] = [];

  // Visit every sourceFile in the program
  for (const sourceFile of program.getSourceFiles()) {
    // Walk the tree to search for classes
    ts.forEachChild(sourceFile, visit);
  }

  // print out the doc
  fs.writeFileSync(outputFile, JSON.stringify(output, undefined, 4));

  return;

  /** visit nodes finding exported classes */
  function visit(node: ts.Node) {
    if (node.kind === ts.SyntaxKind.ClassDeclaration) {
      // This is a top level class, get its symbol
      const doc = serializeClass(<ts.ClassDeclaration>node);
      if (doc) {
        output.push(doc);
      }
      // No need to walk any further, class expressions/inner declarations
      // cannot be exported
    } else if (node.kind === ts.SyntaxKind.ModuleDeclaration) {
      // This is a namespace, visit its children
      ts.forEachChild(node, visit);
    }
  }

  /** Serialize a symbol into a json object */
  function serializeSymbol(symbol: ts.Symbol): DocEntry {
    return {
      name: symbol.getName(),
      documentation: ts.displayPartsToString(
        symbol.getDocumentationComment(undefined)
      ),
      type: checker.typeToString(
        checker.getTypeOfSymbolAtLocation(symbol, symbol.valueDeclaration!)
      ),
    };
  }
  /** Serialize a class symbol infomration */
  function serializeClass(node: ts.ClassDeclaration) {
    const symbol = checker.getSymbolAtLocation(node.name!);
    const mappingType = checker.getTypeAtLocation(node.name!);

    const details = serializeSymbol(symbol!);
    // Get the construct signatures
    details.decorators = node.decorators?.map(serializeDecorator);
    if (!details.decorators?.some(dec => dec.name == 'Entity'))
      return undefined;

    const constructorType = checker.getTypeOfSymbolAtLocation(
      symbol!,
      symbol!.valueDeclaration!
    );
    details.constructors = constructorType
      .getConstructSignatures()
      .map(serializeSignature);

    details.properties = getAllProperties(node, mappingType);

    return details;
  }

  function getAllProperties(
    node: ts.ClassDeclaration | undefined,
    type: ts.Type
  ): DocEntry[] {
    let childProperties: DocEntry[] = [];
    if (!node?.heritageClauses) {
      childProperties = [];
    } else {
      const classDeclaration = node as ts.ClassDeclaration;
      const firstHeritageClause = classDeclaration.heritageClauses![0];
      const firstHeritageClauseType = firstHeritageClause.types![0];

      const extendsSymbol = checker.getSymbolAtLocation(
        firstHeritageClauseType.expression
      );
      const extendsType = checker.getTypeAtLocation(
        firstHeritageClauseType.expression
      );

      for (const clause of node.heritageClauses) {
        if (clause.token == ts.SyntaxKind.ExtendsKeyword) {
          if (clause.types.length != 1) {
            console.warn(
              'error parsing extends expression "' + clause.getText() + '"'
            );
          } else {
            const extendedType = checker.getTypeAtLocation(
              clause.types[0].expression
            );
            if (!extendedType) {
              console.warn(
                'error retrieving symbol for extends expression "' +
                  clause.getText() +
                  '"'
              );
            } else {
              // recursive??
              childProperties = getAllProperties(undefined, extendedType);
            }
          }
        }
      }
    }

    return [
      ...type.getProperties().map(serializeProperties),
      ...childProperties,
    ];
  }

  function serializeProperties(prop: ts.Symbol) {
    return {
      ...serializeSymbol(prop),
      decorators: prop.declarations?.flatMap(serializeDeclarations),
    };
  }

  function serializeDeclarations(declaration: ts.Declaration) {
    return declaration.decorators
      ?.map(serializeDecorator)
      .filter(s => s) as DocEntry[];
  }

  function serializeDecorator(decorator: ts.Decorator) {
    const symbol = checker.getSymbolAtLocation(
      decorator.expression.getFirstToken()!
    );
    const details = serializeSymbol(symbol!);
    details.parameters = parseDecorator(
      details.name,
      decorator.expression?.getFullText()
    );
    details.rawValue = decorator.expression?.getFullText();
    return details;
  }

  function parseSimpleColumnDecorator(
    decoratorType: string | undefined,
    decoratorExpression: string
  ): DocEntry[] | undefined {
    const parameters: DocEntry[] = [];
    if (decoratorExpression == 'Column()') {
      return parameters;
    }
    const rxDecoratorParser = /^Column\('([a-z\-]+)'\)$/i;
    const matches = decoratorExpression.match(rxDecoratorParser);
    if (matches && matches.length == 2) {
      parameters.push({ name: 'columnType', type: matches[1] });
      return parameters;
    }
    return undefined;
  }

  function parseOnlyParamsColumnDecorator(
    decoratorType: string | undefined,
    decoratorExpression: string
  ): DocEntry[] | undefined {
    const parameters: DocEntry[] = [];

    const rxDecoratorParser = /^Column\((\{.*\})\s*\)$/ims;
    const matches = decoratorExpression.match(rxDecoratorParser);
    if (!matches || matches.length != 2) {
      return undefined;
    } else {
      const rxProps = [
        {
          name: 'nullable',
          rx: /nullable:\s*(true|false)/,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1] === 'true';
            } else {
              console.warn('nullable', matches);
            }
          },
          pending: false,
        },
        {
          name: 'unique',
          rx: /unique:\s*(true|false)/,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1] === 'true';
            } else {
              console.warn('unique', matches);
            }
          },
          pending: false,
        },
        {
          name: 'length',
          rx: /length:\s*([0-9]+|[A-Z_]+)/,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              if (parseInt(matches[1]) > 0) return parseInt(matches[1]);
              return parseColLengthConst(matches[1]);
            } else {
              console.warn('length', matches);
            }
          },
          pending: false,
        },
        {
          name: 'default',
          rx: /default:\s*([A-Z_0-9\.]+)/i,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1];
            } else {
              console.warn('default', matches);
            }
          },
          pending: false,
        },
        {
          name: 'name',
          rx: /name:\s*'([A-Z_0-9\.]+)'/i,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1];
            } else {
              console.warn('name', matches);
            }
          },
          pending: false,
        },
        {
          name: 'type',
          rx: /type:\s*'([A-Z_0-9\.]+)'/i,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1];
            } else {
              console.warn('type', matches);
            }
          },
          pending: false,
        },
      ];
      // Split all the props just to check
      const detectedProps = matches[1].split(/\s*([a-z]+?):\s*(.*?)\s*,?/ims);
      for (let i = 1; i < detectedProps.length; i += 3) {
        const parser = rxProps.find(rx => rx.name === detectedProps[i]);
        if (!parser) {
          console.warn(
            'Prop not parsed:',
            detectedProps[i],
            decoratorExpression
          );
        } else {
          // This expression should match
          parser.pending = true;
        }
      }
      // Use the parsers
      rxProps.forEach(handler => {
        const propMatches = matches[1].match(handler.rx);
        if (propMatches) {
          handler.pending = false;
          parameters.push({
            name: handler.name,
            value: handler.valueFn(propMatches),
          });
        }
      });
      // Check if any pending parser
      if (rxProps.some(parser => parser.pending)) {
        console.warn(
          'Column: Parsers didnt match existing prop:',
          rxProps.filter(parser => parser.pending).map(parser => parser.name),
          decoratorExpression
        );
      }
    }
    return parameters;
  }

  function parseColumnDecorator(
    decoratorType: string | undefined,
    decoratorExpression: string
  ): DocEntry[] | undefined {
    const parameters: DocEntry[] = [];
    const simpleResult = parseSimpleColumnDecorator(
      decoratorType,
      decoratorExpression
    );
    if (simpleResult) return simpleResult;

    const simpleResult2 = parseOnlyParamsColumnDecorator(
      decoratorType,
      decoratorExpression
    );
    if (simpleResult2) return simpleResult2;

    const rxDecoratorParser = /^Column\('([a-z\-]+)', (.*?)(\{.*\})\s*\)$/ims;
    const matches = decoratorExpression.match(rxDecoratorParser);
    if (!matches || matches.length != 4) {
      console.warn('Column decorator doesnt match', decoratorExpression);
    } else {
      parameters.push({ name: 'columnType', type: matches[1] });
      if (matches[2]) {
        console.warn('Unexpected matches[2]', matches[2]);
      }

      const rxProps = [
        {
          name: 'nullable',
          rx: /nullable:\s*(true|false)/,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1] === 'true';
            } else {
              console.warn('nullable', matches);
            }
          },
          pending: false,
        },
        {
          name: 'unique',
          rx: /unique:\s*(true|false)/,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1] === 'true';
            } else {
              console.warn('unique', matches);
            }
          },
          pending: false,
        },
        {
          name: 'length',
          rx: /length:\s*([0-9]+|[A-Z_]+)/,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              if (parseInt(matches[1]) > 0) return parseInt(matches[1]);
              return parseColLengthConst(matches[1]);
            } else {
              console.warn('length', matches);
            }
          },
          pending: false,
        },
        {
          name: 'default',
          rx: /default:\s*(['A-Z_0-9\.]+)/i,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1];
            } else {
              console.warn('default', matches);
            }
          },
          pending: false,
        },
      ];
      // Split all the props just to check
      const detectedProps = matches[3].split(/\s*([a-z]+?):\s*(.*?)\s*,?/ims);
      for (let i = 1; i < detectedProps.length; i += 3) {
        const parser = rxProps.find(rx => rx.name === detectedProps[i]);
        if (!parser) {
          console.warn(
            'Prop not parsed:',
            detectedProps[i],
            decoratorExpression
          );
        } else {
          // This expression should match
          parser.pending = true;
        }
      }
      // Use the parsers
      rxProps.forEach(handler => {
        const propMatches = matches[3].match(handler.rx);
        if (propMatches) {
          handler.pending = false;
          parameters.push({
            name: handler.name,
            value: handler.valueFn(propMatches),
          });
        }
      });
      // Check if any pending parser
      if (rxProps.some(parser => parser.pending)) {
        console.warn(
          'Column: Parsers didnt match existing prop:',
          rxProps.filter(parser => parser.pending).map(parser => parser.name),
          decoratorExpression
        );
      }
    }
    return parameters;
  }

  function parseOneToOneDecorator(
    decoratorType: string | undefined,
    decoratorExpression: string
  ): DocEntry[] | undefined {
    const parameters: DocEntry[] = [];
    const rxDecoratorParser =
      /^OneToOne\(\(\) => ([a-z]+), (.*?)(\{.*\})\s*\)$/ims;
    const matches = decoratorExpression.match(rxDecoratorParser);
    if (!matches || matches.length != 4) {
      console.warn('OneToOne decorator doesnt match', decoratorExpression);
    } else {
      parameters.push({ name: 'columnType', type: matches[1] });
      if (matches[2]) {
        console.warn('Unexpected matches[2]', matches[2]);
      }

      const rxProps = [
        {
          name: 'eager',
          rx: /eager:\s*(true|false)/,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1] === 'true';
            } else {
              console.warn('eager', matches);
            }
          },
          pending: false,
        },
        {
          name: 'cascade',
          rx: /cascade:\s*(true|false)/,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1] === 'true';
            } else {
              console.warn('cascade', matches);
            }
          },
          pending: false,
        },
        {
          name: 'onDelete',
          rx: /onDelete:\s*'([a-z _\.]+)'/i,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1];
            } else {
              console.warn('onDelete', matches);
            }
          },
          pending: false,
        },
      ];
      // Split all the props just to check
      const detectedProps = matches[3].split(/\s*([a-z]+?):\s*(.*?)\s*,?/ims);
      for (let i = 1; i < detectedProps.length; i += 3) {
        const parser = rxProps.find(rx => rx.name === detectedProps[i]);
        if (!parser) {
          console.warn(
            'Prop not parsed:',
            detectedProps[i],
            decoratorExpression
          );
        } else {
          // This expression should match
          parser.pending = true;
        }
      }
      // Use the parsers
      rxProps.forEach(handler => {
        const propMatches = matches[3].match(handler.rx);
        if (propMatches) {
          handler.pending = false;
          parameters.push({
            name: handler.name,
            value: handler.valueFn(propMatches),
          });
        }
      });
      // Check if any pending parser
      if (rxProps.some(parser => parser.pending)) {
        console.warn(
          'OneToOne: Parsers didnt match existing prop:',
          rxProps.filter(parser => parser.pending).map(parser => parser.name),
          decoratorExpression
        );
      }
    }
    return parameters;
  }

  function parseSimpleOneToManyDecorator(
    decoratorType: string | undefined,
    decoratorExpression: string
  ): DocEntry[] | undefined {
    const parameters: DocEntry[] = [];
    const rxDecoratorParser =
      /^OneToMany\(\s*\(\)\s*=>\s*([a-z]+),\s*([a-z]+\s*=>\s*[a-z]+\.[a-z]+)\s*\)$/ims;
    const matches = decoratorExpression.match(rxDecoratorParser);
    if (!matches || matches.length != 3) {
      return undefined;
    } else {
      parameters.push({ name: 'columnType', type: matches[1] });
      if (matches[2]) {
        // Parse relation:
        const rxRelation = /([a-z]+) => ([a-z]+)\.([a-z]+)/i;
        const relation = matches[2].match(rxRelation);
        if (relation && relation.length == 4 && relation[1] == relation[2]) {
          parameters.push({
            name: 'relation',
            type: relation[1],
            value: relation[3],
          });
          return parameters;
        } else {
          console.warn(
            'Relation doesnt match',
            matches[2],
            decoratorExpression
          );
        }
      }
    }
  }

  function parseOneToManyDecorator(
    decoratorType: string | undefined,
    decoratorExpression: string
  ): DocEntry[] | undefined {
    const parameters: DocEntry[] = [];

    const simpleResult = parseSimpleOneToManyDecorator(
      decoratorType,
      decoratorExpression
    );
    if (simpleResult) return simpleResult;

    const rxDecoratorParser =
      /^OneToMany\(\s*\(\)\s*=>\s*([a-z]+),\s*([a-z]+\s*=>\s*[a-z]+\.[a-z]+),\s*(\{.*\})\s*\)$/ims;
    const matches = decoratorExpression.match(rxDecoratorParser);
    if (!matches || matches.length != 4) {
      console.warn('OneToMany decorator doesnt match', decoratorExpression);
      parseSimpleOneToManyDecorator(
        decoratorType,
        decoratorExpression
      );
    } else {
      parameters.push({ name: 'columnType', type: matches[1] });
      if (matches[2]) {
        // Parse relation:
        const rxRelation = /([a-z]+) => ([a-z]+)\.([a-z]+)/i;
        const relation = matches[2].match(rxRelation);
        if (relation && relation.length == 4 && relation[1] == relation[2]) {
          parameters.push({
            name: 'relation',
            type: relation[1],
            value: relation[3],
          });
        } else {
          console.warn(
            'Relation doesnt match',
            matches[2],
            decoratorExpression
          );
        }
      }

      const rxProps = [
        {
          name: 'eager',
          rx: /eager:\s*(true|false)/,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1] === 'true';
            } else {
              console.warn('eager', matches);
            }
          },
          pending: false,
        },
        {
          name: 'cascade',
          rx: /cascade:\s*(true|false)/,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1] === 'true';
            } else {
              console.warn('cascade', matches);
            }
          },
          pending: false,
        },
        {
          name: 'onDelete',
          rx: /onDelete:\s*'([A-Z_ \.]+)'/i,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1];
            } else {
              console.warn('onDelete', matches);
            }
          },
          pending: false,
        },
      ];
      // Split all the props just to check
      const detectedProps = matches[3].split(/\s*([a-z]+?):\s*(.*?)\s*,?/ims);
      for (let i = 1; i < detectedProps.length; i += 3) {
        const parser = rxProps.find(rx => rx.name === detectedProps[i]);
        if (!parser) {
          console.warn(
            'Prop not parsed:',
            detectedProps[i],
            decoratorExpression
          );
        } else {
          // This expression should match
          parser.pending = true;
        }
      }
      // Use the parsers
      rxProps.forEach(handler => {
        const propMatches = matches[3].match(handler.rx);
        if (propMatches) {
          handler.pending = false;
          parameters.push({
            name: handler.name,
            value: handler.valueFn(propMatches),
          });
        }
      });
      // Check if any pending parser
      if (rxProps.some(parser => parser.pending)) {
        console.warn(
          'OneToMany: Parsers didnt match existing prop:',
          rxProps.filter(parser => parser.pending).map(parser => parser.name),
          decoratorExpression
        );
      }
    }
    return parameters;
  }

  function parseManyToManyDecoratorWithoutRelation(
    decoratorType: string | undefined,
    decoratorExpression: string
  ): DocEntry[] | undefined {
    // @ManyToOne(() => NVP, nvp => nvp.id, { eager: true, cascade: true })
    const parameters: DocEntry[] = [];
    const rxDecoratorParser =
      /^ManyToOne\(\s*\(\)\s*=>\s*([a-z]+),\s*(\{.*\})\s*\)$/ims;
    const matches = decoratorExpression.match(rxDecoratorParser);
    if (!matches || matches.length != 3) {
      return undefined;
    } else {
      parameters.push({ name: 'columnType', type: matches[1] });

      const rxProps = [
        {
          name: 'eager',
          rx: /eager:\s*(true|false)/,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1] === 'true';
            } else {
              console.warn('eager', matches);
            }
          },
          pending: false,
        },
        {
          name: 'cascade',
          rx: /cascade:\s*(true|false)/,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1] === 'true';
            } else {
              console.warn('cascade', matches);
            }
          },
          pending: false,
        },
        {
          name: 'onDelete',
          rx: /onDelete:\s*'([A-Z_ \.]+)'/i,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1];
            } else {
              console.warn('onDelete', matches);
            }
          },
          pending: false,
        },
      ];
      // Split all the props just to check
      const detectedProps = matches[2].split(/\s*([a-z]+?):\s*(.*?)\s*,?/ims);
      for (let i = 1; i < detectedProps.length; i += 3) {
        const parser = rxProps.find(rx => rx.name === detectedProps[i]);
        if (!parser) {
          console.warn(
            'Prop not parsed:',
            detectedProps[i],
            decoratorExpression
          );
        } else {
          // This expression should match
          parser.pending = true;
        }
      }
      // Use the parsers
      rxProps.forEach(handler => {
        const propMatches = matches[2].match(handler.rx);
        if (propMatches) {
          handler.pending = false;
          parameters.push({
            name: handler.name,
            value: handler.valueFn(propMatches),
          });
        }
      });
      // Check if any pending parser
      if (rxProps.some(parser => parser.pending)) {
        console.warn(
          'ManyToOne: Parsers didnt match existing prop:',
          rxProps.filter(parser => parser.pending).map(parser => parser.name),
          decoratorExpression
        );
      }
    }
    return parameters;
  }

  function parseManyToOneDecorator(
    decoratorType: string | undefined,
    decoratorExpression: string
  ): DocEntry[] | undefined {
    // @ManyToOne(() => NVP, nvp => nvp.id, { eager: true, cascade: true })
    const parameters: DocEntry[] = [];
    const simpleManyToOne = parseManyToManyDecoratorWithoutRelation(
      decoratorType,
      decoratorExpression
    );
    if (simpleManyToOne) {
      return simpleManyToOne;
    }

    const rxDecoratorParser =
      /^ManyToOne\(\s*\(\)\s*=>\s*([a-z]+),\s*([a-z]+\s*=>\s*[a-z]+\.[a-z]+),\s*(\{.*\})\s*\)$/ims;
    const matches = decoratorExpression.match(rxDecoratorParser);
    if (!matches || matches.length != 4) {
      console.warn('ManyToOne decorator doesnt match', decoratorExpression);
    } else {
      parameters.push({ name: 'columnType', type: matches[1] });
      if (matches[2]) {
        // Parse relation:
        const rxRelation = /([a-z]+) => ([a-z]+)\.([a-z]+)/i;
        const relation = matches[2].match(rxRelation);
        if (relation && relation.length == 4 && relation[1] == relation[2]) {
          parameters.push({
            name: 'relation',
            type: relation[1],
            value: relation[3],
          });
        } else {
          console.warn(
            'Relation doesnt match',
            matches[2],
            decoratorExpression
          );
        }
      }

      const rxProps = [
        {
          name: 'eager',
          rx: /eager:\s*(true|false)/,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1] === 'true';
            } else {
              console.warn('eager', matches);
            }
          },
          pending: false,
        },
        {
          name: 'cascade',
          rx: /cascade:\s*(true|false)/,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1] === 'true';
            } else {
              console.warn('cascade', matches);
            }
          },
          pending: false,
        },
        {
          name: 'onDelete',
          rx: /onDelete:\s*'([A-Z_ \.]+)'/i,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1];
            } else {
              console.warn('onDelete', matches);
            }
          },
          pending: false,
        },
      ];
      // Split all the props just to check
      const detectedProps = matches[3].split(/\s*([a-z]+?):\s*(.*?)\s*,?/ims);
      for (let i = 1; i < detectedProps.length; i += 3) {
        const parser = rxProps.find(rx => rx.name === detectedProps[i]);
        if (!parser) {
          console.warn(
            'Prop not parsed:',
            detectedProps[i],
            decoratorExpression
          );
        } else {
          // This expression should match
          parser.pending = true;
        }
      }
      // Use the parsers
      rxProps.forEach(handler => {
        const propMatches = matches[3].match(handler.rx);
        if (propMatches) {
          handler.pending = false;
          parameters.push({
            name: handler.name,
            value: handler.valueFn(propMatches),
          });
        }
      });
      // Check if any pending parser
      if (rxProps.some(parser => parser.pending)) {
        console.warn(
          'ManyToOne: Parsers didnt match existing prop:',
          rxProps.filter(parser => parser.pending).map(parser => parser.name),
          decoratorExpression
        );
      }
    }
    return parameters;
  }

  function parseManyToManyDecorator(
    decoratorType: string | undefined,
    decoratorExpression: string
  ): DocEntry[] | undefined {
    // @ManyToMany(() => NVP, nvp => nvp.id, { eager: true, cascade: true })
    const parameters: DocEntry[] = [];
    const rxDecoratorParser =
      /^ManyToMany\(\(\) => ([a-z]+), ([a-z]+ => [a-z]+\.[a-z]+), (\{.*\})\s*\)$/ims;
    const matches = decoratorExpression.match(rxDecoratorParser);
    if (!matches || matches.length != 4) {
      console.warn('ManyToMany decorator doesnt match', decoratorExpression);
    } else {
      parameters.push({ name: 'columnType', type: matches[1] });
      if (matches[2]) {
        // Parse relation:
        const rxRelation = /([a-z]+) => ([a-z]+)\.([a-z]+)/i;
        const relation = matches[2].match(rxRelation);
        if (relation && relation.length == 4 && relation[1] == relation[2]) {
          parameters.push({
            name: 'relation',
            type: relation[1],
            value: relation[3],
          });
        } else {
          console.warn(
            'Relation doesnt match',
            matches[2],
            decoratorExpression
          );
        }
      }

      const rxProps = [
        {
          name: 'eager',
          rx: /eager:\s*(true|false)/,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1] === 'true';
            } else {
              console.warn('eager', matches);
            }
          },
          pending: false,
        },
        {
          name: 'cascade',
          rx: /cascade:\s*(true|false)/,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1] === 'true';
            } else {
              console.warn('cascade', matches);
            }
          },
          pending: false,
        },
        {
          name: 'onDelete',
          rx: /onDelete:\s*'([A-Z_ \.]+)'/i,
          valueFn: (matches: RegExpMatchArray) => {
            if (matches && matches.length === 2) {
              return matches[1];
            } else {
              console.warn('onDelete', matches);
            }
          },
          pending: false,
        },
      ];
      // Split all the props just to check
      const detectedProps = matches[3].split(/\s*([a-z]+?):\s*(.*?)\s*,?/ims);
      for (let i = 1; i < detectedProps.length; i += 3) {
        const parser = rxProps.find(rx => rx.name === detectedProps[i]);
        if (!parser) {
          console.warn(
            'Prop not parsed:',
            detectedProps[i],
            decoratorExpression
          );
        } else {
          // This expression should match
          parser.pending = true;
        }
      }
      // Use the parsers
      rxProps.forEach(handler => {
        const propMatches = matches[3].match(handler.rx);
        if (propMatches) {
          handler.pending = false;
          parameters.push({
            name: handler.name,
            value: handler.valueFn(propMatches),
          });
        }
      });
      // Check if any pending parser
      if (rxProps.some(parser => parser.pending)) {
        console.warn(
          'ManyToMany: Parsers didnt match existing prop:',
          rxProps.filter(parser => parser.pending).map(parser => parser.name),
          decoratorExpression
        );
      }
    }
    return parameters;
  }

  function parseJoinTableDecorator(
    decoratorType: string | undefined,
    decoratorExpression: string
  ): DocEntry[] | undefined {
    // @JoinTable({ name: 'application_questions' })
    const parameters: DocEntry[] = [];
    const rxDecoratorParser = /^JoinTable\(\{\s*name:\s*'([a-z_]+)'\s*\}\)$/i;
    const matches = decoratorExpression.match(rxDecoratorParser);
    if (!matches || matches.length != 2) {
      console.warn('JoinTable decorator doesnt match', decoratorExpression);
    } else {
      parameters.push({ name: 'value', type: matches[1] });
    }
    return parameters;
  }

  function parseScalarDecorator(
    decoratorType: string | undefined,
    decoratorExpression: string
  ): DocEntry[] | undefined {
    // @Scalar('uuid')
    const parameters: DocEntry[] = [];
    const rxDecoratorParser = /^Scalar\('([a-z_]+)'\)$/i;
    const matches = decoratorExpression.match(rxDecoratorParser);
    if (!matches || matches.length != 2) {
      console.warn('Scalar decorator doesnt match', decoratorExpression);
    } else {
      parameters.push({ name: 'value', type: matches[1] });
    }
    return parameters;
  }

  function parsePrimaryGeneratedColumnDecorator(
    decoratorType: string | undefined,
    decoratorExpression: string
  ): DocEntry[] | undefined {
    // @PrimaryGeneratedColumn('uuid')
    const parameters: DocEntry[] = [];
    const rxDecoratorParser = /^PrimaryGeneratedColumn\('([a-z_]+)'\)$/i;
    const matches = decoratorExpression.match(rxDecoratorParser);
    if (!matches || matches.length != 2) {
      console.warn(
        'PrimaryGeneratedColumn decorator doesnt match',
        decoratorExpression
      );
    } else {
      parameters.push({ name: 'value', type: matches[1] });
    }
    return parameters;
  }

  function parseGeneratedDecorator(
    decoratorType: string | undefined,
    decoratorExpression: string
  ): DocEntry[] | undefined {
    // @Generated('uuid')
    const parameters: DocEntry[] = [];
    const rxDecoratorParser = /^Generated\('([a-z_]+)'\)$/i;
    const matches = decoratorExpression.match(rxDecoratorParser);
    if (!matches || matches.length != 2) {
      console.warn('Generated decorator doesnt match', decoratorExpression);
    } else {
      parameters.push({ name: 'value', type: matches[1] });
    }
    return parameters;
  }

  function parseDecorator(
    decoratorType: string | undefined,
    decoratorExpression: string
  ): DocEntry[] | undefined {
    switch (decoratorType) {
      case 'Entity': {
        break;
      }
      case 'JoinColumn':
      case 'CreateDateColumn':
      case 'UpdateDateColumn':
      case 'VersionColumn':
      case 'InputType':
      case 'ObjectType': {
        //console.warn('Ignored:', decoratorType, decoratorExpression);
        break;
      }
      case 'Column': {
        return parseColumnDecorator(decoratorType, decoratorExpression);
      }
      case 'OneToOne': {
        return parseOneToOneDecorator(decoratorType, decoratorExpression);
      }
      case 'OneToMany': {
        return parseOneToManyDecorator(decoratorType, decoratorExpression);
      }
      case 'ManyToOne': {
        return parseManyToOneDecorator(decoratorType, decoratorExpression);
      }
      case 'ManyToMany': {
        return parseManyToManyDecorator(decoratorType, decoratorExpression);
      }
      case 'JoinTable': {
        return parseJoinTableDecorator(decoratorType, decoratorExpression);
      }
      case 'Scalar': {
        return parseScalarDecorator(decoratorType, decoratorExpression);
      }
      case 'PrimaryGeneratedColumn': {
        return parsePrimaryGeneratedColumnDecorator(
          decoratorType,
          decoratorExpression
        );
      }
      case 'Generated': {
        return parseGeneratedDecorator(decoratorType, decoratorExpression);
      }
      default: {
        console.warn(
          'Decorator not handled:',
          decoratorType,
          decoratorExpression
        );
      }
    }
  }

  /** Serialize a signature (call or construct) */
  function serializeSignature(signature: ts.Signature) {
    return {
      parameters: signature.parameters.map(serializeSymbol),
      returnType: checker.typeToString(signature.getReturnType()),
      documentation: ts.displayPartsToString(
        signature.getDocumentationComment(undefined)
      ),
    };
  }
}

const outputFile = `classes.json`;
const fileList = [
  //'entity.test.ts',
  // 'entities.check.ts',
  'domain/agent/agent/agent.entity.ts',
  'domain/agent/credential/credential.entity.ts',
  'domain/challenge/challenge/challenge.entity.ts',
  'domain/challenge/hub/hub.entity.ts',
  'domain/collaboration/agreement/agreement.entity.ts',
  'domain/collaboration/aspect/aspect.entity.ts',
  'domain/collaboration/callout/callout.entity.ts',
  'domain/collaboration/card-profile/card.profile.entity.ts',
  'domain/collaboration/collaboration/collaboration.entity.ts',
  'domain/collaboration/opportunity/opportunity.entity.ts',
  'domain/collaboration/project/project.entity.ts',
  'domain/collaboration/relation/relation.entity.ts',
  'domain/common/authorization-policy/authorization.policy.entity.ts',
  'domain/common/canvas/canvas.entity.ts',
  'domain/common/canvas-checkout/canvas.checkout.entity.ts',
  'domain/common/lifecycle/lifecycle.entity.ts',
  'domain/common/location/location.entity.ts',
  'domain/common/nvp/nvp.entity.ts',
  'domain/common/preference/preference.definition.entity.ts',
  'domain/common/preference/preference.entity.ts',
  'domain/common/preference-set/preference.set.entity.ts',
  'domain/common/reference/reference.entity.ts',
  'domain/common/tagset/tagset.entity.ts',
  'domain/common/visual/visual.entity.ts',
  'domain/communication/comments/comments.entity.ts',
  'domain/communication/communication/communication.entity.ts',
  'domain/communication/discussion/discussion.entity.ts',
  'domain/communication/updates/updates.entity.ts',
  'domain/community/application/application.entity.ts',
  'domain/community/community/community.entity.ts',
  'domain/community/community-policy/community.policy.entity.ts',
  'domain/community/organization/organization.entity.ts',
  'domain/community/organization-verification/organization.verification.entity.ts',
  'domain/community/profile/profile.entity.ts',
  'domain/community/user/user.entity.ts',
  'domain/community/user-group/user-group.entity.ts',
  'domain/context/actor/actor.entity.ts',
  'domain/context/actor-group/actor-group.entity.ts',
  'domain/context/context/context.entity.ts',
  'domain/context/ecosystem-model/ecosystem-model.entity.ts',
  'domain/template/aspect-template/aspect.template.entity.ts',
  'domain/template/canvas-template/canvas.template.entity.ts',
  'domain/template/lifecycle-template/lifecycle.template.entity.ts',
  'domain/template/template-info/template.info.entity.ts',
  'domain/template/templates-set/templates.set.entity.ts',
  'library/innovation-pack/innovation.pack.entity.ts',
  'library/library/library.entity.ts',
  'platform/activity/activity.entity.ts',
  'domain/common/entity/nameable-entity/nameable.entity.ts',
];

generateJson(fileList, outputFile, {
  target: ts.ScriptTarget.ES5,
  module: ts.ModuleKind.CommonJS,
});
