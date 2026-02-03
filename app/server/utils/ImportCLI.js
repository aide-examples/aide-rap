/**
 * ImportCLI - CLI wrapper for ImportManager
 *
 * Runs imports in batch mode without starting the web server.
 * Used via: node app/rap.js -s <system> --import [entity|all]
 */

const ImportManager = require('./ImportManager');

class ImportCLI {
  constructor(cfg, logger) {
    this.cfg = cfg;
    this.logger = logger;
    this.importManager = new ImportManager(cfg.systemDir, logger);
  }

  /**
   * Run import for one or all entities
   * @param {string} entity - Entity name or 'all'
   * @returns {Promise<{total: number, success: number, failed: number}>}
   */
  async run(entity) {
    const startTime = Date.now();
    this.logger.info('========== IMPORT BATCH START ==========');

    let results;
    if (entity === 'all') {
      results = await this.runAll();
    } else {
      results = await this.runSingle(entity);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    this.logger.info(`========== IMPORT BATCH END (${duration}s) ==========`);
    this.printSummary(results);

    return results;
  }

  /**
   * Run import for a single entity
   * @param {string} entityName - Entity name
   */
  async runSingle(entityName) {
    this.logger.info(`Importing: ${entityName}`);

    const result = await this.importManager.runImport(entityName);
    this.logResult(entityName, result);

    return {
      total: 1,
      success: result.success ? 1 : 0,
      failed: result.success ? 0 : 1
    };
  }

  /**
   * Run imports for all entities with import definitions
   */
  async runAll() {
    const imports = this.importManager.getAvailableImports();
    let success = 0;
    let failed = 0;

    for (const imp of imports) {
      if (!imp.hasDefinition) continue;

      this.logger.info(`Importing: ${imp.entity}`);
      const result = await this.importManager.runImport(imp.entity);
      this.logResult(imp.entity, result);

      if (result.success) {
        success++;
      } else {
        failed++;
      }
    }

    return { total: success + failed, success, failed };
  }

  /**
   * Log result for a single entity
   */
  logResult(entity, result) {
    if (result.success) {
      this.logger.info(`  OK ${entity}: ${result.recordsWritten} records written (${result.recordsFiltered} filtered out)`);
    } else {
      this.logger.error(`  FAILED ${entity}: ${result.error}`);
    }
  }

  /**
   * Print summary to console
   */
  printSummary(results) {
    console.log('');
    if (results.failed === 0) {
      console.log(`Summary: ${results.success}/${results.total} imports succeeded`);
    } else {
      console.log(`Summary: ${results.success}/${results.total} succeeded, ${results.failed} FAILED`);
    }
  }
}

module.exports = ImportCLI;
