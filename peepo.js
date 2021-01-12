// source peepo from a CSV
const csv = require('csvtojson')
const asana = require('asana')

const {
  ASANA_TOKEN,
  ASANA_WORKSPACE = '30686770106337', // eqworks
  ASANA_PROJECT = '1152701043959235', // dev avail
} = process.env
const VACAY_SECTIONS = '1152701043959236,1153045408573969'
const client = asana.Client.create().useAccessToken(ASANA_TOKEN)


module.exports.loadPeepo = (sheet) => csv().fromFile(sheet)

// can also get these from UI to save some API calls
// [
//   { gid: '1152701043959236', name: 'Vacation' },
//   { gid: '1153045408573969', name: 'Not Avail (not able to work)' }
// ]
const getSections = (project = ASANA_PROJECT) => client.sections.findByProject(project, {
  opt_fields: 'gid,name'
}).filter(({ name }) => name.toLowerCase().startsWith('vacation') || name.toLowerCase().startsWith('not avail'))

// https://developers.asana.com/docs/search-tasks-in-a-workspace
const searchTasks = (params) => client.tasks.searchInWorkspace(ASANA_WORKSPACE, {
  completed: true,
  is_subtask: false,
  sort_by: 'created_at',
  sort_ascending: true,
  opt_fields: 'assignee.email,start_on,due_on,due_at,created_at',
  limit: 100,
  ...params,
}).then(({ data }) => data)

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

module.exports.getVacays = async ({
  after,
  before,
  projects = ASANA_PROJECT,
  sections = VACAY_SECTIONS,
}) => {
  const common = { 'due_on.after': after }
  if (projects) {
    common['projects.all'] = projects
  }
  if (sections) {
    common['sections.any'] = sections
  }
  // get tasks
  let data = []
  let created_at
  let gid
  let it = 0
  while (true) {
    const params = { ...common }
    if (created_at) {
      params['created_at.after'] = created_at
    }
    // TODO: add 429 error handling to also sleep 60 seconds
    const tasks = await searchTasks(params) || []
    const last = tasks[tasks.length - 1]
    if (tasks.length === 1 && gid === last.gid) {
      break
    }
    created_at = last.created_at
    gid = last.gid
    data = data.concat(tasks)
    // comply to 60 reqs/min ASANA search API constraint
    it += 1
    if (it >= 59) {
      await sleep(60 * 1000)
    }
  }
  return data.reduce((acc, { gid, assignee, start_on: start, due_on, due_at }) => {
    if (!acc.some((t) => t.gid === gid) && assignee && assignee.email && (start || due_on) <= before) {
      acc.push({ email: assignee.email.toLowerCase(), start: start || due_at || due_on, end: due_at || due_on })
    }
    return acc
  }, []).reduce((acc, { email, start, end }) => {
    acc[email] = [...(acc[email] || []), { start, end }]
    return acc
  }, {})
}

if (require.main === module) {
  this.getVacays({ after: '2020-01-01', before: '2020-12-31' }).then(JSON.stringify).then(console.log)
}
