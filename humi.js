const csv = require('csvtojson')


module.exports.loadTimeOffs = async (sheet, { department = 'Product & Development' }) => {
  const timeoffs = await csv().fromFile(sheet)
  // filter by department
  return timeoffs.filter(({ Department }) => Department.toLowerCase() === department.toLowerCase())
}
