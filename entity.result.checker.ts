/* eslint-disable @typescript-eslint/no-non-null-asserted-optional-chain */
/* eslint-disable @typescript-eslint/no-non-null-assertion */
/* eslint-disable quotes */
import data from '../classes.json';
import Db from 'mysql2-async';
import { isEqual } from 'lodash';

import {
  createConnection,
  QueryError,
  RowDataPacket,
  ConnectionOptions,
} from 'mysql2';
import { cp } from 'fs';

export const db = new Db({
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: '....',
  database: 'alkemio',
});

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

interface Table {
  table_name: string;
}
interface Column {
  column_name: string;
  column_default: string | null;
  is_nullable: 'YES' | 'NO';
  data_type: string;
  character_maximum_length: number | null;
  character_set_name: string | null;
  collation_name: string | null;
  column_type: string;
  column_key: string | null;
  extra: string | null;
  is_generated: string | null;
}

interface Constraint {
  constraint_name: string;
  table_name: string;
  column_name: string;
  referenced_table_name: string;
  referenced_column_name: string;
  update_rule:
    | 'RESTRICT'
    | 'CASCADE'
    | 'SET NULL'
    | 'NO ACTION'
    | 'SET DEFAULT';
  delete_rule:
    | 'RESTRICT'
    | 'CASCADE'
    | 'SET NULL'
    | 'NO ACTION'
    | 'SET DEFAULT';
}

const baseEntityColumns: Column[] = [
  {
    column_name: 'id',
    column_default: null,
    is_nullable: 'NO',
    data_type: 'char',
    character_maximum_length: 36,
    character_set_name: 'utf8mb4',
    collation_name: 'utf8mb4_general_ci',
    column_type: 'varchar(36)', // PENDING: I think it should be char(36), but we have MANY being varchar(36)
    column_key: 'PRI',
    extra: '',
    is_generated: 'NEVER',
  },
  {
    column_name: 'createdDate',
    column_default: 'current_timestamp(6)',
    is_nullable: 'NO',
    data_type: 'datetime',
    character_maximum_length: null,
    character_set_name: null,
    collation_name: null,
    column_type: 'datetime(6)',
    column_key: '',
    extra: '',
    is_generated: 'NEVER',
  },
  {
    column_name: 'updatedDate',
    column_default: 'current_timestamp(6)',
    is_nullable: 'NO',
    data_type: 'datetime',
    character_maximum_length: null,
    character_set_name: null,
    collation_name: null,
    column_type: 'datetime(6)',
    column_key: '',
    extra: 'on update current_timestamp(6)',
    is_generated: 'NEVER',
  },
  {
    column_name: 'version',
    column_default: null,
    is_nullable: 'NO',
    data_type: 'int',
    character_maximum_length: null,
    character_set_name: null,
    collation_name: null,
    column_type: 'int(11)',
    column_key: '',
    extra: '',
    is_generated: 'NEVER',
  },
];

const nameableEntityColumns: Column[] = [
  {
    column_name: 'nameID',
    column_default: null,
    is_nullable: 'NO',
    data_type: 'varchar',
    character_maximum_length: 36,
    character_set_name: 'utf8mb4',
    collation_name: 'utf8mb4_general_ci',
    column_type: 'varchar(36)',
    column_key: '',
    extra: '',
    is_generated: 'NEVER',
  },
  {
    column_name: 'displayName',
    column_default: null,
    is_nullable: 'NO',
    data_type: 'varchar',
    character_maximum_length: 255,
    character_set_name: 'utf8mb4',
    collation_name: 'utf8mb4_general_ci',
    column_type: 'varchar(255)',
    column_key: '',
    extra: '',
    is_generated: 'NEVER',
  },
];

const defaultEntityDecorator = [
  {
    name: 'Entity',
    documentation: '',
    type: 'any',
    rawValue: 'Entity()',
  },
];

const defaultJoinColumnDecorator = {
  name: 'JoinColumn',
  documentation: '',
  type: 'any',
  rawValue: 'JoinColumn()',
};

const ExpectedColumnTypes = {
  string: ['varchar', 'char', 'text', 'longtext'],
  'string[]': ['text'],
  boolean: ['boolean', 'bit', 'tinyint'],
  number: ['int', 'tinyint', 'smallint'],
  HubVisibility: ['varchar'],
  CalloutType: ['varchar'],
  CalloutState: ['varchar'],
  CalloutVisibility: ['varchar'],
  PreferenceValueType: ['varchar'],
  PreferenceType: ['varchar'],
  CommunityType: ['varchar'],
  ActivityEventType: ['varchar'],
};

enum LogLevel {
  default,
  warning,
  error,
  MISTAKE,
}

function log(
  s: string | undefined,
  indent = 0,
  level: LogLevel = LogLevel.default,
  objectToLog: unknown = undefined
) {
  while (indent > 0) {
    s = '  ' + s;
    indent--;
  }
  switch (level) {
    case LogLevel.error: {
      if (objectToLog === undefined) {
        console.error(s);
      } else {
        console.error(s, objectToLog);
      }
      break;
    }
    case LogLevel.warning: {
      if (objectToLog === undefined) {
        console.warn(s);
      } else {
        console.warn(s, objectToLog);
      }
      break;
    }
    case LogLevel.MISTAKE: {
      // Inconsistencies found:
      if (objectToLog === undefined) {
        console.log(s);
      } else {
        console.log(s, objectToLog);
      }
      break;
    }
    case LogLevel.default:
    default: {
      if (objectToLog === undefined) {
        console.log(s);
      } else {
        console.log(s, objectToLog);
      }
    }
  }
}

const viewed = {
  tables: [] as string[],
  constraints: [] as string[],
  addViewedTable: (t: string) =>
    viewed.tables.includes(t) ? undefined : viewed.tables.push(t),
  addViewedConstraint: (t: string) =>
    viewed.constraints.includes(t) ? undefined : viewed.constraints.push(t),
};

function camelToUnderscore(s: string | undefined) {
  if (!s) return s;
  // Special case: All uppercase:
  if (s.match(/^[A-Z]+$/)) {
    return s.toLowerCase();
  }

  return s
    .replace(/([A-Z])/g, '_$1')
    .toLowerCase()
    .replace(/^_/, '');
}

function getTables(): Promise<Table[]> {
  return db.getall(
    `SELECT table_name
    FROM information_schema.tables
    WHERE table_schema = 'alkemio'`
  );
}

function getColumns(tableName: string): Promise<Column[]> {
  return db.getall(
    `SELECT column_name, column_default, is_nullable, data_type, character_maximum_length, character_set_name, collation_name, column_type, column_key, extra, is_generated
    FROM information_schema.columns
    WHERE table_schema = 'alkemio' AND table_name = :tableName
    ORDER BY ordinal_position ASC`,
    { tableName: tableName }
  );
}

function getConstraints(): Promise<Constraint[]> {
  return db.getall(
    `SELECT
      A.constraint_name,
      A.table_name,
      A.column_name,
      A.referenced_table_name,
      A.referenced_column_name,
      B.match_option,
      B.update_rule,
      B.delete_rule
  FROM information_schema.key_column_usage as A INNER JOIN information_schema.referential_constraints as B
  ON A.constraint_name = B.constraint_name
  WHERE A.constraint_schema = 'alkemio' AND referenced_table_schema = 'alkemio' AND referenced_column_name IS NOT NULL
  ORDER BY column_name;`
  );
}

function checkColumns(
  column: Column,
  expected: Column,
  logCharVarcharDifferences = true
) {
  // Exactly equal columns:
  if (isEqual(column, expected)) return true;

  // If they are not equal, let's see if it's just the type char/varchar difference
  const { column_type, data_type, ...colProps } = column;
  const {
    column_type: expected_column_type,
    data_type: expected_data_type,
    ...expectedColProps
  } = expected;

  if (
    !['char', 'varchar'].includes(data_type) ||
    !['char', 'varchar'].includes(expected_data_type)
  ) {
    return false;
  }
  // Check with char/varchar flexibility:
  if (isEqual(colProps, expectedColProps)) {
    if (column_type === expected_column_type) return true;
    if (logCharVarcharDifferences) {
      // Only differs in char/varchar
      log(
        `Column ${column.column_name} is ${column_type} but is expected to be: ${expected_column_type}`,
        2,
        LogLevel.MISTAKE
      );
    }
    return true;
  }
  return false;
}

function diffColumns(columnA: Column, expected: Column) {
  let prop: keyof Column;
  const diff = [];
  for (prop in columnA) {
    if (columnA[prop] !== expected[prop]) {
      diff.push({ prop: prop, value: columnA[prop], expected: expected[prop] });
    }
  }
  return diff;
}

async function checkBaseEntity(
  entity: DocEntry,
  tableName: string | undefined
) {
  if (!tableName) {
    log('Error in this entity', 2, LogLevel.error);
    return false;
  }
  const r = await db.getrow(
    "SELECT table_name FROM information_schema.tables where table_schema = 'alkemio' AND table_name = :tableName;",
    { tableName: tableName || '' }
  );
  if (!r || r.table_name !== tableName) {
    log("Entity doesn't have a table ", 1, LogLevel.error, tableName);
    return false;
  } else {
    viewed.addViewedTable(tableName);
    if (
      entity.decorators?.length !== 1 ||
      !entity.decorators.some(d => d.name === 'Entity')
    ) {
      log('Object doesnt have Entity decorator', 2, LogLevel.warning, entity);
    }
  }
  // Check BaseEntity columns:
  const columns = await getColumns(tableName);

  for (const index in baseEntityColumns) {
    const expectedColumn = baseEntityColumns[index];
    const c = columns.find(c => c.column_name == expectedColumn.column_name);
    if (!c) {
      log(
        `Missing baseEntity column: ${expectedColumn.column_name} in table: ${tableName}`,
        2,
        LogLevel.warning
      );
      continue;
    }
    if (!checkColumns(c, expectedColumn)) {
      log(
        `Different baseEntity column: ${expectedColumn.column_name} in table: ${tableName}`,
        2,
        LogLevel.warning,
        c
      );
    }
  }
  if (!isEqual(entity.decorators, defaultEntityDecorator)) {
    log(
      `Entity:${entity.name} has unknown entity decorator`,
      2,
      LogLevel.MISTAKE,
      entity.decorators
    );
  }
}

function isEntityNameInData(entityName: string | undefined) {
  if (!entityName) return false;
  for (const element of data) {
    const entity = element as DocEntry;
    if (
      entity.name === entityName &&
      isEqual(entity.decorators, defaultEntityDecorator)
    ) {
      return true;
    }
  }
  return false;
}

async function checkNoExtraColumns(
  entity: DocEntry,
  tableName: string | undefined
) {
  if (!tableName) {
    return false;
  }
  // Check BaseEntity columns:
  const columns = await getColumns(tableName);
  for (const tableColumn of columns) {
    if (
      baseEntityColumns.find(c => c.column_name === tableColumn.column_name)
    ) {
      // It's a BaseEntity column, we already have checked that
      continue;
    }
    if (
      entity.properties?.find(prop => prop.name === tableColumn.column_name)
    ) {
      // All good, tableColumn found in the Entity, we'll check that later.
      continue;
    }
    if (
      tableColumn.column_name?.endsWith('Id') ||
      tableColumn.column_name?.endsWith('ID')
    ) {
      // Check if it's a relation:
      const relationName = tableColumn.column_name.slice(0, -2);
      if (entity.properties?.find(prop => prop.name === relationName)) {
        // All good, tableColumn found in the Entity, we'll check that later.
        continue;
      }
    }
    if (tableColumn.column_name === 'authorizationId') {
      // Ignore authorization column
      continue;
    }

    // still missing, try to find a property in the entity that has the Column(name)
    if (
      entity.properties?.some(prop =>
        prop.decorators?.some(
          d =>
            d.name === 'Column' &&
            d.parameters?.some(
              p => p.name === 'name' && p.value === tableColumn.column_name
            )
        )
      )
    ) {
      // Found renamed column, all good
      continue;
    }

    // Column in the table was not found in the entity
    log(
      `Column in table ${tableName} is missing in entity ${entity.name}`,
      2,
      LogLevel.warning,
      tableColumn
    );
  }
}

async function checkNameableEntities(
  entity: DocEntry,
  tableName: string | undefined
) {
  if (!tableName) {
    return false;
  }
  // Check BaseEntity columns:
  const columns = await getColumns(tableName);
  for (const tableColumn of columns) {
    if (tableColumn.column_name.toLowerCase() === 'nameid') {
      // Ignore nameID column if looks okay
      const defaultNameIdColumn = nameableEntityColumns.find(
        col => col.column_name === 'nameID'
      )!;
      if (!checkColumns(tableColumn, defaultNameIdColumn)) {
        const diff = diffColumns(tableColumn, defaultNameIdColumn);
        log(
          `NameID column doesn't match in ${tableName}`,
          2,
          LogLevel.MISTAKE,
          diff
        );
      } else {
        continue;
      }
    }

    if (tableColumn.column_name.toLowerCase() === 'displayname') {
      // Ignore nameID column if looks okay
      const defaultDisplayNameColumn = nameableEntityColumns.find(
        col => col.column_name === 'displayName'
      )!;

      if (!checkColumns(tableColumn, defaultDisplayNameColumn)) {
        const diff = diffColumns(tableColumn, defaultDisplayNameColumn);
        log(
          `displayName column doesn't match in ${tableName}`,
          2,
          LogLevel.MISTAKE,
          diff
        );
      } else {
        continue;
      }
    }
  }
}

async function checkEntityProps(
  entity: DocEntry,
  tableName: string | undefined
) {
  if (!tableName) {
    return false;
  }
  if (!entity.properties) {
    return true;
  }
  // Check BaseEntity columns:
  const tableColumns = await getColumns(tableName);
  const tableConstraints = await getConstraints();

  for (const prop of entity.properties) {
    if (prop.decorators?.some(d => d && d.name === 'Column')) {
      // This property should be a colum in the table:
      const columnDecorator = prop.decorators?.find(d => d.name === 'Column')!;
      await checkColumnProp(
        entity.name,
        tableName,
        tableColumns,
        prop,
        columnDecorator
      );
    }
    if (prop.decorators?.some(d => d && d.name === 'OneToOne')) {
      // This property is a OneToOne relation:
      const oneToOneDecorator = prop.decorators?.find(
        d => d.name === 'OneToOne'
      )!;
      await checkOneToOneProp(
        entity.name,
        tableName,
        tableColumns,
        tableConstraints,
        prop,
        oneToOneDecorator
      );
    }
    if (prop.decorators?.some(d => d && d.name === 'ManyToOne')) {
      // This property is a ManyToOne relation:
      const manyToOneDecorator = prop.decorators?.find(
        d => d.name === 'ManyToOne'
      )!;
      await checkManyToOneProp(
        entity.name,
        tableName,
        tableColumns,
        tableConstraints,
        prop,
        manyToOneDecorator
      );
    }
    if (prop.decorators?.some(d => d && d.name === 'OneToMany')) {
      // This property is a ManyToOne relation:
      const oneToManyDecorator = prop.decorators?.find(
        d => d.name === 'OneToMany'
      )!;
      await checkOneToManyProp(
        entity.name,
        tableName,
        tableColumns,
        tableConstraints,
        prop,
        oneToManyDecorator
      );
    }
    if (prop.decorators?.some(d => d && d.name === 'ManyToMany')) {
      // This property is a ManyToOne relation:
      const manyToManyDecorator = prop.decorators?.find(
        d => d.name === 'ManyToMany'
      )!;
      const joinTableDecorator = prop.decorators?.find(
        d => d.name === 'JoinTable'
      )!;
      await checkManyToManyProp(
        entity.name,
        tableName,
        tableColumns,
        tableConstraints,
        prop,
        manyToManyDecorator,
        joinTableDecorator
      );
    }
  }
}

async function checkColumnProp(
  entityName: string | undefined,
  tableName: string,
  tableColumns: Column[],
  prop: DocEntry,
  columnDecorator: DocEntry
) {
  let tableColumnName = prop.name;
  if (columnDecorator.parameters?.some(param => param.name === 'name')) {
    // Overriden columnName
    tableColumnName = columnDecorator.parameters?.find(
      param => param.name === 'name'
    )?.value;
  }

  const tableColumn = tableColumns.find(
    col => col.column_name === tableColumnName
  );
  if (!tableColumn) {
    log(
      `Column ${tableColumn} not found in table ${tableName}`,
      2,
      LogLevel.error
    );
    return; // continue
  }
  // Check @Column properties have no other decorators:
  if (
    prop.decorators?.some(
      d => d && d.name !== 'Column' && d.name !== 'Generated'
    )
  ) {
    log(
      `@Column property ${prop.name} has other decorators: `,
      3,
      LogLevel.MISTAKE,
      prop.decorators.filter(d => d && d.name !== 'Column')
    );
  }
  // Check entiy.prop matches tableColumn:
  await checkEntityPropMatchesTableColumn(
    entityName,
    tableName,
    prop,
    columnDecorator,
    tableColumn
  );
}

async function checkEntityPropMatchesTableColumn(
  entityName: string | undefined,
  tableName: string,
  prop: DocEntry,
  columnDecorator: DocEntry,
  tableColumn: Column
) {
  if (prop.decorators?.find(d => d.name === 'Generated')) {
    // Autogenerated column - check auto_increment:
    if (!(tableColumn.extra === 'auto_increment')) {
      log(
        'Generated column is not auto_increment',
        3,
        LogLevel.error,
        tableColumn
      );
    }
  }

  //log(`${prop.name} ${prop.type}`, 2, LogLevel.default);
  if (prop.type && Object.keys(ExpectedColumnTypes).includes(prop.type)) {
    if (
      !ExpectedColumnTypes[
        prop.type as keyof typeof ExpectedColumnTypes
      ].includes(tableColumn.data_type)
    ) {
      log(
        `${prop.name}:${prop.type} doesn't have the expected column type: ${tableColumn.column_name}:${tableColumn.data_type}:${tableColumn.column_type}`,
        2,
        LogLevel.MISTAKE
      );
    }
  } else {
    log(
      `Property type not found: ${prop.name} ${prop.type}`,
      2,
      LogLevel.default
    );
  }

  if (!columnDecorator.parameters) return;
  for (const param of columnDecorator.parameters) {
    switch (param.name) {
      case 'columnType': {
        let paramType = param.type;
        if (paramType === 'simple-array') paramType = 'text';
        if (tableColumn.data_type !== paramType) {
          log(
            `Entity:${entityName} table:${tableName} property:${prop.name} column:${tableColumn.column_name} Expected type:${param.type} but has type:${tableColumn.data_type}`,
            3,
            LogLevel.MISTAKE
          );
        }
        break;
      }
      case 'nullable': {
        if (param.value !== true && param.value !== false) {
          log('Unknown nullable value', 2, LogLevel.error, param);
        }
        if (tableColumn.is_nullable !== (param.value ? 'YES' : 'NO')) {
          log(
            `Entity:${entityName} table:${tableName} property:${prop.name} column:${tableColumn.column_name} Expected Nullable:${param.value} but has:${tableColumn.is_nullable}`,
            3,
            LogLevel.MISTAKE
          );
        }
        break;
      }
      case 'length': {
        const length = parseInt(param.value);
        if (length <= 0 || isNaN(length)) {
          log('Unknown length value', 2, LogLevel.error, param);
        }
        if (tableColumn.character_maximum_length !== length) {
          log(
            `Entity:${entityName} table:${tableName} property:${prop.name} column:${tableColumn.column_name} Expected Length:${param.value} but has:${tableColumn.character_maximum_length}`,
            3,
            LogLevel.MISTAKE
          );
        }
        break;
      }
      case 'type': {
        switch (param.value) {
          case 'boolean': {
            if (
              !['boolean', 'tinyint(1)', 'bit', 'bit(1)'].includes(
                tableColumn.column_type
              )
            )
              log(
                `Column type mismatch: ${prop.name} (boolean) Column ${tableColumn.column_name} (${tableColumn.column_type})`,
                2,
                LogLevel.MISTAKE
              );
            break;
          }
          // TODO: implement more column types, for now there any in the Entities
          default: {
            log('Unknown Column param type:', 2, LogLevel.error, {
              param,
              tableColumn,
            });
          }
        }
        break;
      }
      case 'unique': {
        if (param.value === true) {
          if (tableColumn.column_key !== 'UNI') {
            log(
              `Prop ${prop.name} has unique parameter but Column ${tableColumn.column_name} is not unique`,
              2,
              LogLevel.MISTAKE
            );
          }
        }
        break;
      }
      case 'default':
      case 'name': {
        // Ignore these params, nothing to check about them
        break;
      }
      default: {
        log('Unknown column param', 2, LogLevel.error, { param, tableColumn });
      }
    }
  }
}

async function checkOneToOneProp(
  entityName: string | undefined,
  tableName: string,
  tableColumns: Column[],
  tableConstraints: Constraint[],
  prop: DocEntry,
  oneToOneDecorator: DocEntry
) {
  // Check that this prop only has this OneToOne decorator and another JoinColumn
  if (prop.decorators?.length !== 2) {
    log(
      `${prop.name} has unknown decorators, maybe a missing JoinColumn?`,
      2,
      LogLevel.error,
      prop.decorators
    );
  }

  const unknownDecorators = prop.decorators?.filter(
    d => !(d.name === 'OneToOne' || isEqual(d, defaultJoinColumnDecorator))
  );
  if (!unknownDecorators || unknownDecorators.length > 0) {
    log(
      `${prop.name} has unknown decorators`,
      2,
      LogLevel.error,
      unknownDecorators
    );
  }
  // Check the types, just in case:
  const referencedEntity = prop.type;
  if (
    !referencedEntity ||
    referencedEntity !==
      oneToOneDecorator.parameters?.find(p => p.name === 'columnType')?.type
  ) {
    log(
      `Unknown related entities ${entityName} ${prop.name}`,
      2,
      LogLevel.error
    );
  }
  // Check the Foreign Key in the database:
  const foreignKeyColumnName = `${prop.name}Id`;
  const foreignKeyColumns = tableColumns.filter(
    c => c.column_name.toLowerCase() === foreignKeyColumnName.toLowerCase()
  );
  if (foreignKeyColumns.length !== 1) {
    log(
      `${prop.name} OneToOne relation doesn't have a ${foreignKeyColumnName} column`,
      2,
      LogLevel.MISTAKE
    );
    return;
  } else {
    // TODO: Pending, maybe change all uuid varchars to binary or to char in the future
    // if (foreignKeyColumns[0].column_type !== 'char(36)') {
    //   log(
    //     `${prop.name} OneToOne relation column ${foreignKeyColumnName} is not char(36)`,
    //     2,
    //     LogLevel.MISTAKE
    //   );
    // }
  }

  if (!isEntityNameInData(referencedEntity)) {
    log(`${referencedEntity} is not a valid entity`, 2, LogLevel.error);
    return;
  }
  const referencedTableName = camelToUnderscore(referencedEntity);

  const constraintsMatching = tableConstraints.filter(
    c =>
      c.table_name === tableName &&
      c.column_name.toLowerCase() === foreignKeyColumnName.toLowerCase() &&
      c.referenced_table_name === referencedTableName &&
      c.referenced_column_name === 'id'
  );
  if (!constraintsMatching || constraintsMatching.length !== 1) {
    if (constraintsMatching.length > 1) {
      log(
        'More than one constraint matching this relation?',
        2,
        LogLevel.error,
        constraintsMatching
      );
    } else {
      log(
        `Missing FK on column ${foreignKeyColumnName} to ${referencedTableName}.id`,
        2,
        LogLevel.MISTAKE
      );
    }
  } else {
    checkConstraintParameters(
      prop,
      oneToOneDecorator.parameters,
      constraintsMatching[0]
    );
  }
}

async function checkManyToOneProp(
  entityName: string | undefined,
  tableName: string,
  tableColumns: Column[],
  tableConstraints: Constraint[],
  prop: DocEntry,
  manyToOneDecorator: DocEntry
) {
  // Check that this prop only has only this ManyToOne
  if (prop.decorators?.length !== 1) {
    log(
      `${prop.name} has unknown decorators`,
      2,
      LogLevel.error,
      prop.decorators
    );
  }

  const unknownDecorators = prop.decorators?.filter(
    d => d !== manyToOneDecorator
  );
  if (!unknownDecorators || unknownDecorators.length > 0) {
    log(
      `${prop.name} has unknown decorators`,
      2,
      LogLevel.error,
      unknownDecorators
    );
  }
  // Check the types, just in case:
  const referencedEntity = prop.type;
  if (
    !referencedEntity ||
    referencedEntity !==
      manyToOneDecorator.parameters?.find(p => p.name === 'columnType')?.type
  ) {
    log(
      `Unknown related entities ${entityName} ${prop.name}`,
      2,
      LogLevel.error
    );
  }
  // Check the Foreign Key in the database:
  const foreignKeyColumnName = `${prop.name}Id`;
  const foreignKeyColumns = tableColumns.filter(
    c => c.column_name.toLowerCase() === foreignKeyColumnName.toLowerCase()
  );
  if (foreignKeyColumns.length !== 1) {
    log(
      `${prop.name} ManyToOne relation doesn't have a ${foreignKeyColumnName} column`,
      2,
      LogLevel.MISTAKE
    );
    return;
  } else {
    // TODO: Pending, maybe change all uuid varchars to binary or to char in the future
    // if (foreignKeyColumns[0].column_type !== 'char(36)') {
    //   log(
    //     `${prop.name} ManyToOne relation column ${foreignKeyColumnName} is not char(36)`,
    //     2,
    //     LogLevel.MISTAKE
    //   );
    // }
  }

  if (!isEntityNameInData(referencedEntity)) {
    log(`${referencedEntity} is not a valid entity`, 2, LogLevel.error);
    return;
  }
  const referencedTableName = camelToUnderscore(referencedEntity);

  const constraintsMatching = tableConstraints.filter(
    c =>
      c.table_name === tableName &&
      c.column_name.toLowerCase() === foreignKeyColumnName.toLowerCase() &&
      c.referenced_table_name === referencedTableName &&
      c.referenced_column_name === 'id'
  );
  if (!constraintsMatching || constraintsMatching.length !== 1) {
    if (constraintsMatching.length > 1) {
      log(
        'More than one constraint matching this relation?',
        2,
        LogLevel.error,
        constraintsMatching
      );
    } else {
      log(
        `Missing FK on column ${foreignKeyColumnName} to ${referencedTableName}.id`,
        2,
        LogLevel.MISTAKE
      );
    }
  } else {
    checkConstraintParameters(
      prop,
      manyToOneDecorator.parameters,
      constraintsMatching[0]
    );
  }
}

async function checkOneToManyProp(
  entityName: string | undefined,
  tableName: string,
  tableColumns: Column[],
  tableConstraints: Constraint[],
  prop: DocEntry,
  oneToManyDecorator: DocEntry
) {
  // Check that this prop only has only this OneToMany
  if (prop.decorators?.length !== 1) {
    log(
      `${prop.name} has unknown decorators`,
      2,
      LogLevel.error,
      prop.decorators
    );
  }

  const unknownDecorators = prop.decorators?.filter(
    d => d !== oneToManyDecorator
  );
  if (!unknownDecorators || unknownDecorators.length > 0) {
    log(
      `${prop.name} has unknown decorators`,
      2,
      LogLevel.error,
      unknownDecorators
    );
  }
  // Check the types, just in case:
  let referencedEntity = prop.type;
  if (referencedEntity?.endsWith('[]')) {
    referencedEntity = referencedEntity.slice(0, -2);
  } else {
    log(
      `prop ${prop.name} should be of type array if the relation is OneToMany`,
      2,
      LogLevel.MISTAKE
    );
  }
  if (
    !referencedEntity ||
    referencedEntity !==
      oneToManyDecorator.parameters?.find(p => p.name === 'columnType')?.type
  ) {
    log(
      `Unknown related entities ${entityName} ${prop.name}`,
      2,
      LogLevel.error
    );
  }
  // Check the Foreign Key in the database:
  const foreignKeyColumnName = `${entityName}Id`;

  if (!isEntityNameInData(referencedEntity)) {
    log(`${referencedEntity} is not a valid entity`, 2, LogLevel.error);
    return;
  }
  const referencedTableName = camelToUnderscore(referencedEntity);

  const constraintsMatching = tableConstraints.filter(
    c =>
      c.table_name === referencedTableName &&
      c.column_name.toLowerCase() === foreignKeyColumnName.toLowerCase() &&
      c.referenced_table_name === tableName &&
      c.referenced_column_name === 'id'
  );
  if (!constraintsMatching || constraintsMatching.length !== 1) {
    if (constraintsMatching.length > 1) {
      log(
        'More than one constraint matching this relation?',
        2,
        LogLevel.error,
        constraintsMatching
      );
    } else {
      log(
        `<Check manually> ${entityName} ${prop.name} Missing FK on table ${referencedTableName} column ${foreignKeyColumnName} to ${tableName}.id`,
        2,
        LogLevel.MISTAKE
      );
    }
  } else {
    checkConstraintParameters(
      prop,
      oneToManyDecorator.parameters,
      constraintsMatching[0]
    );
  }
}

async function checkManyToManyProp(
  entityName: string | undefined,
  tableName: string,
  tableColumns: Column[],
  tableConstraints: Constraint[],
  prop: DocEntry,
  manyToManyDecorator: DocEntry,
  joinTableDecorator: DocEntry
) {
  // Check that this prop only has only this ManyToMany and the JoinTable
  if (prop.decorators?.length !== 2) {
    log(
      `${prop.name} has unknown decorators. Maybe a missing JoinTable?`,
      2,
      LogLevel.error,
      prop.decorators
    );
  }

  const unknownDecorators = prop.decorators?.filter(
    d => !(d === manyToManyDecorator || d === joinTableDecorator)
  );
  if (!unknownDecorators || unknownDecorators.length > 0) {
    log(
      `${prop.name} has unknown decorators`,
      2,
      LogLevel.error,
      unknownDecorators
    );
  }
  // Check the types, just in case:
  const referencedEntity = prop.type;
  if (
    !referencedEntity ||
    referencedEntity !==
      manyToManyDecorator.parameters?.find(p => p.name === 'columnType')?.type
  ) {
    log(
      `Unknown related entities ${entityName} ${prop.name}`,
      2,
      LogLevel.error
    );
  }
  log('<Check manually> ManyToMany relation', 2, LogLevel.MISTAKE, {
    entityName,
    manyToManyDecorator,
  });
}

function checkConstraintParameters(
  prop: DocEntry,
  params: DocEntry[] | undefined,
  constraint: Constraint
) {
  viewed.addViewedConstraint(constraint.constraint_name);
  if (!params || params.length === 0) return;
  for (const param of params) {
    switch (param?.name) {
      case 'onDelete': {
        if (constraint.delete_rule !== param?.value) {
          log(
            `${prop.name} OnDelete policies don't match ${param.value} ${constraint.delete_rule}`,
            2,
            LogLevel.MISTAKE
          );
        }
        break;
      }
      case 'cascade': {
        // Ignore this for now, there are too many errors, I don't think this is right
        /*
        if (constraint.update_rule !== 'CASCADE') {
          log(
            `${prop.name} OnUpdate policies don't match ${param.value} ${constraint.update_rule}`,
            2,
            LogLevel.MISTAKE
          );
        }*/
        /*if (constraint.delete_rule !== 'CASCADE') {
          log(
            `${prop.name} OnDelete policies don't match ${param.value} ${constraint.delete_rule}`,
            2,
            LogLevel.MISTAKE
          );
        }
        */
        break;
      }
      case 'columnType': {
        // already checked
        break;
      }
      case 'relation': {
        /* if (
          param.type !== constraint.table_name ||
          param.value !== constraint.referenced_table_name
        ) {
          log(
            `Relation: ${param.type} !== ${constraint.table_name} || ${param.value} !== ${constraint.referenced_table_name}`,
            2,
            LogLevel.error
          );
        }*/
        break;
      }
      case 'eager': {
        // ignore
        break;
      }
      default: {
        log(`Unknown Constraint parameter`, 2, LogLevel.error, param);
      }
    }
  }
}

async function checkUnusedConstraints() {
  const tableConstraints = await getConstraints();
  for (const c of tableConstraints.filter(
    con => con.referenced_table_name !== 'authorization_policy'
  )) {
    if (!viewed.constraints.includes(c.constraint_name)) {
      log(`${c.constraint_name} not used by typeorm?`, 0, LogLevel.error, c);
    }
  }
}

async function checkUnusedTables() {
  const tables = await getTables();
  for (const t of tables) {
    if (!viewed.tables.includes(t.table_name)) {
      log(`${t.table_name} not used by typeorm?`, 0, LogLevel.error);
    }
  }
}
const skip: string[] = []; //['Agent', 'Credential', 'Collaboration', 'Challenge'];

async function main() {
  //  console.log(await getColumns('user'));
  for (const element of data) {
    const entity = element as DocEntry;

    const tableName = camelToUnderscore(entity.name);
    log(`- [ ] ${entity.name}`, 0, LogLevel.default);

    if (skip.includes(entity.name ?? '')) continue;

    if (await checkBaseEntity(entity, tableName)) {
      log('Entity isnt a correct BaseEntity', 2, LogLevel.MISTAKE);
    }
    await checkNoExtraColumns(entity, tableName);
    await checkNameableEntities(entity, tableName);
    await checkEntityProps(entity, tableName);
    // Check all used tables
    //return;
  }
  log('Done checking', 0, LogLevel.default);
  await checkUnusedConstraints();
  await checkUnusedTables();
  log('Done', 0, LogLevel.default);
}
main();
