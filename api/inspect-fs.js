const fs = require('fs');
const path = require('path');

module.exports = async (req, res) => {
  const info = {
    __dirname,
    cwd: process.cwd(),
    filesInVarTask: [],
    filesInJs: [],
    filesInChapters: [],
    errs: []
  };

  const listDir = (dir, key) => {
    try {
      if (fs.existsSync(dir)) {
        info[key] = fs.readdirSync(dir);
      } else {
        info[key] = ['NOT_FOUND'];
      }
    } catch(e) {
      info.errs.push(`${key}: ${e.message}`);
    }
  };

  listDir('/var/task', 'filesInVarTask');
  listDir('/var/task/js', 'filesInJs');
  listDir('/var/task/js/chapters', 'filesInChapters');

  res.status(200).json(info);
};
