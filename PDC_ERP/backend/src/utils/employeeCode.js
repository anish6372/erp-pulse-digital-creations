const { db } = require('../db');

function generateEmployeeCode() {
  const countRow = db.prepare('SELECT COUNT(*) as cnt FROM users').get();
  let num = (countRow ? countRow.cnt : 0) + 1001;
  let code = `EMP${num}`;
  while (db.prepare('SELECT id FROM users WHERE employee_code=?').get(code)) {
    num++;
    code = `EMP${num}`;
  }
  return code;
}

module.exports = { generateEmployeeCode };
