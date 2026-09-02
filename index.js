const mysql = require('mysql2')
const fs = require('fs')
const path = require('path');

// AWS certificate
const caCertificatePath = path.join(__dirname, './certs/global-bundle.pem');
const caCertificate = fs.readFileSync(caCertificatePath, 'utf8');

module.exports = (acapi, options, cb) => {
  const bootstrapping = options?.bootstrapping ?? true

  const log = acapi.log || console

  const init = async() => {
    if (acapi.aclog) { acapi.aclog.headline({ headline: 'mysql' }) }

    // init multiple instances for different purposes
    acapi.mysql = {}
    acapi.mysqlPromise = {}
    for (const db of acapi.config?.database?.servers) {
      if (db.ignoreBootstrap) { continue }

      const allowedKeys = ['host', 'port', 'user', 'password', 'database', 'timezone', 'ssl', 'socketPath']
      const connection = Object.fromEntries(allowedKeys.filter(k => k in db).map(k => [k, db[k]]))

      if (acapi.config.localDatabase) {
        Object.assign(connection, acapi.config.localDatabase)
      }

      // AWS has new certificates which are not yet available in mysql2
      if (connection.ssl === 'Amazon RDS') {
        connection.ssl = {
          rejectUnauthorized: true,
          ca: [caCertificate]
        }
      }

      acapi.mysql[db.server] = mysql.createPool({
        ...connection,
        multipleStatements: true,
        connectionLimit: db.connectionLimit ?? 5
      })
      // provide await option for every connection
      acapi.mysqlPromise[db.server] = acapi.mysql[db.server].promise()

      try {
        await acapi.mysqlPromise[db.server].getConnection()
        if (acapi.aclog) { acapi.aclog.serverInfo(connection) }
      }
      catch (e) {
        log.error('ac-bootstrap-mysql | getConnection | Failed %s', e?.message)
      }
    }
  }

  if (cb) {
    console.warn("ac-bootstrap-mysql -> Warning: The callback method is considered legacy. Please use the async/await approach.");
    init(acapi, options)
        .then(() => cb(null))
        .catch(err => {
          if (bootstrapping) { return cb(err) }
          if (err) { log.error('Bootstrap.initMysql:failed with %j', err) }
          process.exit(0)
        })
  }
  else {
    return init(acapi, options);
  }

}
