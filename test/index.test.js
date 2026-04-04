'use strict';

const { expect } = require('chai');

// ─── mock helpers ────────────────────────────────────────────────────────────

/**
 * Builds a minimal mysql2 mock.
 * @param {object} opts
 * @param {Error} [opts.getConnectionError]  If set, getConnection() rejects with this error.
 */
function buildMysql2Mock({ getConnectionError } = {}) {
  const createdPools = [];

  function createPool(config) {
    const pool = {
      config,
      promise() {
        return {
          getConnection() {
            if (getConnectionError) return Promise.reject(getConnectionError);
            return Promise.resolve({});
          }
        };
      }
    };
    createdPools.push(pool);
    return pool;
  }

  return { createPool, createdPools };
}

/**
 * Loads index.js with the given mysql2 mock injected via require.cache.
 * The real mysql2 is restored afterward; index.js is evicted from the cache
 * so each call returns a freshly-bound module.
 */
function loadModule(mysql2Mock) {
  const indexPath  = require.resolve('../index.js');
  const mysql2Path = require.resolve('mysql2');

  delete require.cache[indexPath];

  const savedMysql2 = require.cache[mysql2Path];
  require.cache[mysql2Path] = {
    id: mysql2Path,
    filename: mysql2Path,
    loaded: true,
    exports: mysql2Mock,
    children: [],
    paths: []
  };

  let mod;
  try {
    mod = require('../index.js');
  } finally {
    if (savedMysql2) {
      require.cache[mysql2Path] = savedMysql2;
    } else {
      delete require.cache[mysql2Path];
    }
    delete require.cache[indexPath];
  }

  return mod;
}

/**
 * Returns a minimal acapi object.
 * @param {object} opts
 * @param {Array}  opts.servers       database.servers list
 * @param {object} [opts.localDatabase]
 */
function buildAcapi({ servers = [], localDatabase } = {}) {
  const acapi = {
    config: {
      database: { servers }
    },
    log: {
      error: () => {},
      warn:  () => {}
    }
  };
  if (localDatabase) acapi.config.localDatabase = localDatabase;
  return acapi;
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('ac-bootstrap-mysql', () => {

  // ── pool creation ──────────────────────────────────────────────────────────
  describe('pool creation', () => {
    it('creates acapi.mysql and acapi.mysqlPromise for a single server', async () => {
      const mysql2 = buildMysql2Mock();
      const bootstrap = loadModule(mysql2);
      const acapi = buildAcapi({
        servers: [{ server: 'main', host: 'localhost', user: 'root', password: '', database: 'test' }]
      });

      await bootstrap(acapi, {});

      expect(acapi.mysql).to.have.property('main');
      expect(acapi.mysqlPromise).to.have.property('main');
      expect(mysql2.createdPools).to.have.length(1);
    });

    it('creates a pool for every server in the list', async () => {
      const mysql2 = buildMysql2Mock();
      const bootstrap = loadModule(mysql2);
      const acapi = buildAcapi({
        servers: [
          { server: 'read',  host: 'db-read',  user: 'root' },
          { server: 'write', host: 'db-write', user: 'root' }
        ]
      });

      await bootstrap(acapi, {});

      expect(acapi.mysql).to.have.property('read');
      expect(acapi.mysql).to.have.property('write');
      expect(mysql2.createdPools).to.have.length(2);
    });

    it('skips servers with ignoreBootstrap: true', async () => {
      const mysql2 = buildMysql2Mock();
      const bootstrap = loadModule(mysql2);
      const acapi = buildAcapi({
        servers: [
          { server: 'main', host: 'localhost',  user: 'root' },
          { server: 'skip', host: 'other-host', user: 'root', ignoreBootstrap: true }
        ]
      });

      await bootstrap(acapi, {});

      expect(acapi.mysql).to.have.property('main');
      expect(acapi.mysql).to.not.have.property('skip');
      expect(mysql2.createdPools).to.have.length(1);
    });

    it('injects multipleStatements and connectionLimit into every pool', async () => {
      const mysql2 = buildMysql2Mock();
      const bootstrap = loadModule(mysql2);
      const acapi = buildAcapi({
        servers: [{ server: 'main', host: 'localhost', user: 'root', password: '' }]
      });

      await bootstrap(acapi, {});

      const { config } = mysql2.createdPools[0];
      expect(config.multipleStatements).to.equal(true);
      expect(config.connectionLimit).to.equal(5);
    });

    it('only passes expected connection fields to createPool', async () => {
      const mysql2 = buildMysql2Mock();
      const bootstrap = loadModule(mysql2);
      const acapi = buildAcapi({
        servers: [{
          server: 'main', host: 'localhost', port: 3306,
          user: 'root', password: 'secret', database: 'app',
          timezone: '+00:00', extraField: 'should-not-appear'
        }]
      });

      await bootstrap(acapi, {});

      const { config } = mysql2.createdPools[0];
      expect(config).to.have.all.keys(
        'host', 'port', 'user', 'password', 'database',
        'timezone', 'multipleStatements', 'connectionLimit'
      );
      expect(config).to.not.have.property('extraField');
      expect(config).to.not.have.property('server');
    });
  });

  // ── SSL handling ───────────────────────────────────────────────────────────
  describe('SSL handling', () => {
    it('replaces the "Amazon RDS" ssl string with a certificate object', async () => {
      const mysql2 = buildMysql2Mock();
      const bootstrap = loadModule(mysql2);
      const acapi = buildAcapi({
        servers: [{ server: 'main', host: 'rds.amazonaws.com', user: 'root', ssl: 'Amazon RDS' }]
      });

      await bootstrap(acapi, {});

      const { ssl } = mysql2.createdPools[0].config;
      expect(ssl).to.be.an('object');
      expect(ssl.rejectUnauthorized).to.equal(true);
      expect(ssl.ca).to.be.an('array').with.length(1);
      expect(ssl.ca[0]).to.be.a('string').and.include('CERTIFICATE');
    });

    it('leaves other ssl values unchanged', async () => {
      const mysql2 = buildMysql2Mock();
      const bootstrap = loadModule(mysql2);
      const acapi = buildAcapi({
        servers: [{ server: 'main', host: 'localhost', user: 'root', ssl: { rejectUnauthorized: false } }]
      });

      await bootstrap(acapi, {});

      expect(mysql2.createdPools[0].config.ssl).to.deep.equal({ rejectUnauthorized: false });
    });
  });

  // ── localDatabase override ─────────────────────────────────────────────────
  describe('localDatabase override', () => {
    it('merges localDatabase values into the connection config', async () => {
      const mysql2 = buildMysql2Mock();
      const bootstrap = loadModule(mysql2);
      const acapi = buildAcapi({
        servers: [{ server: 'main', host: 'prod-host', user: 'root', password: 'prod-secret' }],
        localDatabase: { host: '127.0.0.1', password: 'local-pass' }
      });

      await bootstrap(acapi, {});

      const { config } = mysql2.createdPools[0];
      expect(config.host).to.equal('127.0.0.1');
      expect(config.password).to.equal('local-pass');
    });
  });

  // ── error handling ─────────────────────────────────────────────────────────
  describe('error handling', () => {
    it('logs a getConnection error without throwing', async () => {
      const connError = new Error('ECONNREFUSED');
      const mysql2 = buildMysql2Mock({ getConnectionError: connError });
      const bootstrap = loadModule(mysql2);
      const errors = [];
      const acapi = buildAcapi({
        servers: [{ server: 'main', host: 'localhost', user: 'root' }]
      });
      acapi.log = { error: (...args) => errors.push(args) };

      await bootstrap(acapi, {}); // must not throw

      expect(errors).to.have.length(1);
      expect(errors[0][0]).to.include('ac-bootstrap-mysql');
      expect(errors[0][1]).to.include('ECONNREFUSED');
    });

    it('continues and creates remaining pools after a failed getConnection', async () => {
      const connError = new Error('ECONNREFUSED');
      const mysql2 = buildMysql2Mock({ getConnectionError: connError });
      const bootstrap = loadModule(mysql2);
      const acapi = buildAcapi({
        servers: [
          { server: 'first',  host: 'bad-host',  user: 'root' },
          { server: 'second', host: 'bad-host2', user: 'root' }
        ]
      });
      acapi.log = { error: () => {} };

      await bootstrap(acapi, {});

      expect(mysql2.createdPools).to.have.length(2);
      expect(acapi.mysql).to.have.property('first');
      expect(acapi.mysql).to.have.property('second');
    });
  });

  // ── async/await mode ───────────────────────────────────────────────────────
  describe('promise (async/await) mode', () => {
    it('returns a Promise when no callback is provided', () => {
      const mysql2 = buildMysql2Mock();
      const bootstrap = loadModule(mysql2);
      const acapi = buildAcapi({ servers: [] });

      const result = bootstrap(acapi, {});
      expect(result).to.be.instanceOf(Promise);
      return result;
    });

    it('resolves without error on empty server list', async () => {
      const mysql2 = buildMysql2Mock();
      const bootstrap = loadModule(mysql2);
      const acapi = buildAcapi({ servers: [] });

      await bootstrap(acapi, {}); // must not throw
      expect(mysql2.createdPools).to.have.length(0);
    });
  });

  // ── callback (legacy) mode ─────────────────────────────────────────────────
  describe('callback (legacy) mode', () => {
    it('calls cb(null) on success', (done) => {
      const mysql2 = buildMysql2Mock();
      const bootstrap = loadModule(mysql2);
      const acapi = buildAcapi({
        servers: [{ server: 'main', host: 'localhost', user: 'root' }]
      });

      bootstrap(acapi, {}, (err) => {
        expect(err).to.be.null;
        done();
      });
    });

    it('calls cb(err) when bootstrapping is true and init throws', (done) => {
      const mysql2 = buildMysql2Mock();
      const bootstrap = loadModule(mysql2);
      // database.servers is missing → init will throw "undefined is not iterable"
      const acapi = { config: {}, log: { error: () => {} } };

      bootstrap(acapi, { bootstrapping: true }, (err) => {
        expect(err).to.be.instanceOf(TypeError);
        done();
      });
    });
  });
});
