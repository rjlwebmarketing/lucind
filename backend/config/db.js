// MySQL pool. On Railway the MySQL plugin provides MYSQL_URL (or the MYSQLHOST/PORT/USER/PASSWORD/DATABASE set).
const mysql = require('mysql2/promise');
const url = process.env.MYSQL_URL || process.env.DATABASE_URL;
const pool = url
  ? mysql.createPool(url + (url.includes('?') ? '&' : '?') + 'charset=utf8mb4')
  : mysql.createPool({
      host: process.env.MYSQLHOST || 'localhost',
      port: Number(process.env.MYSQLPORT || 3306),
      user: process.env.MYSQLUSER || 'root',
      password: process.env.MYSQLPASSWORD || '',
      database: process.env.MYSQLDATABASE || 'railway',
      charset: 'utf8mb4'
    });
module.exports = pool;
