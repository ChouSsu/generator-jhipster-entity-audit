const glob = require('glob');
const faker = require('faker');
const fs = require('fs');

// In order to have consistent results with Faker, the seed is fixed.
faker.seed(42);

const TPL = 'template';

const changeset = (changelogDate, entityTableName) => `
    <!-- Added the entity audit columns -->
    <changeSet id="${changelogDate}-1-audit" author="jhipster-entity-audit">
        <addColumn tableName="${entityTableName}">
            <column name="created_by" type="varchar(50)">
                <constraints nullable="false"/>
            </column>
            <column name="created_date" type="timestamp" defaultValueDate="\${now}">
                <constraints nullable="false"/>
            </column>
            <column name="last_modified_by" type="varchar(50)"/>
            <column name="last_modified_date" type="timestamp"/>
        </addColumn>
    </changeSet>`;

const changesetLoadColumn = `
            <!-- Added the entity audit load columns -->
            <column name="created_by" type="string" />`;

const fakeDataColumns = [
  {
    databaseColumn: 'created_by',
    fieldType: 'varchar',
    validateRules: {
      required: true,
      maxLength: 50
    }
  }
];

const addFakeDataColumnsToLiquibaseFakeDataLoadfile = (fakeDataFile, newFakeDataColumns) => {
  if (newFakeDataColumns) {
    // read existing file
    let fileContent = fs.readFileSync(fakeDataFile, 'utf8');
    // var newColumns = JSON.parse(fakeDataColumns);
    let newColumns = fakeDataColumns;

    // process fileContent: add additional columns with fake data
    const rows = fileContent.split('\n');
    for (let rowIdx in rows) {
      if (!rows[rowIdx] || rows[rowIdx].length === 0) {
        break;
      } else {
        let rowContent = rows[rowIdx].split(';');

        let data = '';
        if (parseInt(rowIdx, 10) === 0) {
          // header row
          newColumns.forEach((newCol) => {
            data = newCol.databaseColumn;
            rowContent.push(data);
          });
        } else {
          // data row
          for (let idx in newColumns) {
            if (newColumns[idx]) {
              if (newColumns[idx].fieldType === 'integer'
                || newColumns[idx].fieldType === 'bigint'
                || newColumns[idx].fieldType === 'double'
                || newColumns[idx].fieldType.startsWith('decimal')) {
                data = faker.random.number({
                  max: newColumns[idx].validateRules.maxValue ? newColumns[idx].validateRules.maxValue : undefined,
                  min: newColumns[idx].validateRules.minValue ? newColumns[idx].validateRules.minValue : undefined
                });
              } else if (newColumns[idx].fieldType === '${floatType}') {
                data = faker.random.number({
                  max: newColumns[idx].validateRules.maxValue ? newColumns[idx].validateRules.maxValue : undefined,
                  min: newColumns[idx].validateRules.minValue ? newColumns[idx].validateRules.minValue : undefined,
                  precision: 0.01
                });
              } else if (newColumns[idx].fieldType === '${uuidType}') {
                data = faker.random.uuid();
              } else if (newColumns[idx].fieldType === 'boolean') {
                data = faker.random.boolean();
              } else if (newColumns[idx].fieldType === 'date') {
                data = faker.date.recent().toISOString().split('T')[0];
              } else if (newColumns[idx].fieldType === 'datetime') {
                data = faker.date.recent().toISOString().split('.')[0];
              } else if (newColumns[idx].fieldType.startsWith('varchar')) {
                data = faker.random.word();
              }
              // Validation rules
              if (newColumns[idx].validateRules.pattern) {
                data = new this.randexp(newColumns[idx].validateRules.pattern).gen();
              }
              if (newColumns[idx].validateRules.maxLength) {
                data = data.substring(0, newColumns[idx].validateRules.maxLength);
              }
              if (newColumns[idx].validateRules.minLength) {
                data = data.length > newColumns[idx].validateRules.minLength ? data : data + 'X'.repeat(newColumns[idx].validateRules.minLength - data.length);
              }

              // test if generated data is still compatible with the regexp as we potentially modify it with min/maxLength
              if (newColumns[idx].validateRules.pattern &&
                !new RegExp('^' + newColumns[idx].validateRules.pattern + '$').test(data)) {
                data = '';
              }

              // manage required
              if (newColumns[idx].validateRules.required && data === '') {
                rowContent = [];
                break;
              }

              rowContent.push(data);
            }
          }
        }
        const item = rowContent.map(modified => { return modified; }).join(';');
        rows[rowIdx] = item;
      }
    }

    // write modified data back to file
    const result = rows.map(modified => { return modified }).join('\n');
    fs.writeFileSync(fakeDataFile, result, 'utf8');
  }
};

const copyFiles = (gen, files) => {
  files.forEach((file) => {
    gen.copyTemplate(file.from, file.to, file.type ? file.type : TPL, gen, file.interpolate ? {
      interpolate: file.interpolate
    } : undefined);
  });
};

const updateEntityAudit = function (entityName, entityData, javaDir, resourceDir, updateIndex) {
  if (this.auditFramework === 'custom') {
    // extend entity with AbstractAuditingEntity
    if (!this.fs.read(`${javaDir}domain/${entityName}.java`, {
      defaults: ''
    }).includes('extends AbstractAuditingEntity')) {
      this.replaceContent(`${javaDir}domain/${entityName}.java`, `public class ${entityName}`, `public class ${entityName} extends AbstractAuditingEntity`);
    }
    // extend DTO with AbstractAuditingDTO
    if (entityData.dto === 'mapstruct') {
      if (!this.fs.read(`${javaDir}service/dto/${entityName}DTO.java`, {
        defaults: ''
      }).includes('extends AbstractAuditingDTO')) {
        this.replaceContent(`${javaDir}service/dto/${entityName}DTO.java`, `public class ${entityName}DTO`, `public class ${entityName}DTO extends AbstractAuditingDTO`);
      }
    }

    // update liquibase changeset
    const file = glob.sync(`${resourceDir}/config/liquibase/changelog/*_added_entity_${entityName}.xml`)[0];
    const entityTableName = entityData.entityTableName ? entityData.entityTableName : entityName;
    this.addChangesetToLiquibaseEntityChangelog(file, changeset(this.changelogDate, this.getTableName(entityTableName)));

    this.addLoadColumnToLiquibaseEntityChangeSet(file, changesetLoadColumn);

    // Fake-Data Load File
    addFakeDataColumnsToLiquibaseFakeDataLoadfile(`${resourceDir}/config/liquibase/data/${entityName}.csv`, fakeDataColumns);
  } else if (this.auditFramework === 'javers') {
    // check if repositories are already annotated
    const auditTableAnnotation = '@JaversSpringDataAuditable';
    const pattern = new RegExp(auditTableAnnotation, 'g');
    const content = this.fs.read(`${javaDir}repository/${entityName}Repository.java`, 'utf8');

    if (!pattern.test(content)) {
      // add javers annotations to repository
      if (!this.fs.read(`${javaDir}repository/${entityName}Repository.java`, {
        defaults: ''
      }).includes('@JaversSpringDataAuditable')) {
        this.replaceContent(`${javaDir}repository/${entityName}Repository.java`, `public interface ${entityName}Repository`, `@JaversSpringDataAuditable\npublic interface ${entityName}Repository`);
        this.replaceContent(`${javaDir}repository/${entityName}Repository.java`, `domain.${entityName};`, `domain.${entityName};\nimport org.javers.spring.annotation.JaversSpringDataAuditable;`);
      }

      // this is used from :entity subgenerator to update the list of
      // audited entities (if audit page available) in `#getAuditedEntities`
      // method in `JaversEntityAuditResource` class, in case that list
      // has changed after running the generator
      if (updateIndex && this.fs.exists(`${javaDir}web/rest/JaversEntityAuditResource.java`)) {
        const files = [{
          from: `${this.javaTemplateDir}/web/rest/_JaversEntityAuditResource.java`,
          to: `${javaDir}web/rest/JaversEntityAuditResource.java`
        }];
        copyFiles(this, files);
      }
    }
  }
};

module.exports = {
  changeset,
  copyFiles,
  updateEntityAudit
};
