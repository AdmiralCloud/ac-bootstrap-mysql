# ac-bootstrap-mysql
Please use this script whenever you want to connect to our AdmiralCloud databases.

This new version supports async/await but is still fully backwards compatible. It supports the current AWS certificates.

# Setup

## Configuration
Make sure the configuration is available at app.config (acapi.config):

```
const app = {
  config: {
    database: {
      dataTimeFormat: 'YYYY-MM-DD HH:mm:ss',
      servers: [
        { 
          server: 'your_name_for_the_database', 
          host: 'localhost', 
          port: 3306, 
          user: 'your_user',
          password: 'your_password',
          ssl: 'Amazon RDS' // required on LIVE infrastructure, remove on local or DEV stage
        }
      ]
    }
  }
}
```

Note: Usually host, user, password and ssl should come from a AWS secret! You can overwrite all values with a values from app.config.localDatabase.

## Usage in your code
### Init
Init during bootstrap:
````
await acbMysql(app)

// with callback
acbMysql(app, { bootstrapping: true }, err => {
  ...
})

````
If you use **bootstrapping: true** the callback function will return with an error, otherwise it will log an error and exit the process.


### Queries

Now you have the database connection available using async/await or callback (deprecated). The with await use app.mysqlPromise, with callback use app.mysql.

```
const query = 'SELECT * FROM user WHERE id = 1'
const [ rows, fields ] = await app.mysqlPromise[your_name_for_the_database].query(query)

// with callback
app.mysql[your_name_for_the_database].query(query, (err, result) => {
  // 
})

```
