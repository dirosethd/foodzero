const sql = require('mssql');

const config = {
  server: process.env.DB_SERVER || 'localhost',
  database: process.env.DB_NAME || 'FoodZero',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  options: {
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
  },
  pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
};

if (process.env.DB_PORT) {
  config.port = Number(process.env.DB_PORT);
} else if (process.env.DB_INSTANCE) {
  config.options.instanceName = process.env.DB_INSTANCE;
}

let poolPromise;

function getPool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config).connect().catch((err) => {
      poolPromise = undefined;
      throw err;
    });
  }
  return poolPromise;
}

/** Выполнить параметризованный запрос: query('SELECT ... WHERE Id=@id', { id: [sql.Int, 5] }) */
async function query(text, params = {}) {
  const pool = await getPool();
  const request = pool.request();
  for (const [name, [type, value]] of Object.entries(params)) {
    request.input(name, type, value);
  }
  const result = await request.query(text);
  return result.recordset || [];
}

module.exports = { sql, getPool, query };
