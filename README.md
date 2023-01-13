Small utility made to go through all the [Alkemio](https://github.com/alkem-io/server) typeorm entities and check if they match their table in the MySQL database.
The first step, a typescript typeorm entity parser, is based on an example from the [Typescript wiki](https://github.com/microsoft/TypeScript-wiki/blob/main/Using-the-Compiler-API.md#using-the-type-checker) to generate Typescript documentation.

Not proud at all of this code, especially the parser has a lot of copy-paste and can be way cleaner and simplified, but it worked. With time I would check why inherited properties are not properly read on some classes and try to read Typeorm decorators with the typescript compiler instead of regular expressions.

### Set up:

    install ts-node globally
    npm install ts-node -g

install these NPM packages in the Alkemio/server:

    "reflect-metadata": "^0.1.13",
    "lodash": "^4.17.21",
    "@types/lodash": "^4.14.191",
    "mysql2": "^2.3.3",
    "mysql2-async": "^1.1.3",

copy these files to the server/src folder:

    entity.parser.ts
    entity.result.checker.ts


It's a two-step process:

### 1. Generate a JSON from typescript entities
First step goes through all the entities and generates a JSON file with information about them.
An array at the end of `entity.parser.ts` has the file list of all the entities in Alkemio server. **Needs to be manually updated**.
Basically, it uses **typescript** compiler to read those TS files and read the @Entity, @Field, @OneToOne.... decorators that I have found used in Alkemio codebase, but some Typeorm decorators may be missing.

- Run it with `ts-node src/entity.parser.ts`
- Will generate a JSON in the root of the server called classes.json

##### Known issues:
Has a bit of trouble going deep in certain entities with inheritance. Didn't have time to investigate further, but some properties are missing if the entity has a certain number of inheritances. Workarounded them by copying the missing properties from the parent entities to the children in server code, in order to have a full and accurate output JSON, but it's not the proper way to go, the entities shouldn't need to be modified for the analyzer to work.
The problem is in `getAllProperties` that doesn't read properly some heritageClauses. This needs to be debugged to be able to go as *high* as needed in the inheritance tree.


### 2. Compare that JSON against the database:
Second step connects to the MySQL database and checks that all the tables match the JSON generated.
Connection credentials must be set at the beginning of the file. It connects to the database and queries the `information_schema`.
Will output some markdown that can be "easily" read reporting the inconsistencies between the entities described in the JSON and the database.
This tool shows inconsistencies but makes no changes in the database. MySQL queries could be generated at this step but our inconsistencies were not too many and we made it manually.

### Output:
- Markdown checklist with all the entities read from the JSON file and the inconsistencies found in the db (Columns with different type, size, null/not null...)
- Missing foreign keys in tables that have a Typeorm @Decorator
- A list of the MySQL tables that are not in the JSON (don't have a .entity. file). (many-to-many relation tables are shown here, and migrations_typeorm... that's normal, just ignore them).
