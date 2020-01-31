const shuffle = require('lodash.shuffle')
const Holidays = require('date-holidays')
const Moment = require('moment-timezone')
const { extendMoment } = require('moment-range')
const moment = extendMoment(Moment)


const COLUMNS = Object.freeze([
  // 'User',
  'Email',
  // 'Client',
  'Project',
  'Task',
  // 'Description',
  // 'Billable',
  'Start date', // YYYY-MM-DD
  'Start time', // HH:mm:ss
  'Duration', // HH:mm:ss
  // 'Tags',
])

// default distributions
const TASKS = Object.freeze({
  'Research/Design': 0.1,
  Development: 0.7,
  'QA/Maintenance': 0.1,
  'Admin/Ops': 0.1,
})
const PROJECTS = Object.freeze({
  Locus: 1,
  ATOM: 0,
})

const HOURS = 8 // default daily work hours per user
const START = '09:00:00' // default work start
const TZ = 'America/Toronto'
const HD = new Holidays('CA', 'ON')


const genDaily = ({
  Email,
  day,
  hours = HOURS,
  start = START,
  projects = PROJECTS,
  tasks = TASKS,
}) => {
  const startDate = (day ? moment.tz(day, TZ) : moment.tz(TZ)).format('YYYY-MM-DD')
  let startTime = moment.tz(`${startDate} ${start}`, TZ).utc()
  const durations = {}

  shuffle(Object.entries(projects)).filter(([, pportion]) => pportion > 0).forEach(([Project, pportion]) => {
    shuffle(Object.entries(tasks)).filter(([, portion]) => portion > 0).forEach(([Task, portion]) => {
      const err = (1 + (Math.random() * 2 - 1) * 0.1) // +/- 10% error
      const d = moment.duration(hours * pportion * portion * err, 'hours')
      durations[`${Project}::${Task}`] = {
        startTime: startTime.format('HH:mm:ss'),
        Duration: moment.utc(d.asMilliseconds()).format('HH:mm:ss'),
      }
      startTime.add(d)
    })
  })

  const rows = Object.entries(durations).map(([key, { startTime, Duration }]) => ({
    Email,
    Project: key.split('::')[0],
    Task: key.split('::')[1],
    'Start Date': startDate,
    'Start Time': startTime,
    Duration,
  }))

  return rows
}

const genYear = ({ year, Email }) => {
  const start = moment.tz(`${year}-01-01 00:00:00`, 'America/Toronto')
  const end = moment(start).endOf('year')
  const range = moment.range(start, end)

  console.log(COLUMNS.map(c => `"${c}"`).join(','))
  for (let day of range.by('day')) {
    // skip weekends and public holidays
    // TODO: skip given vacation days too
    if (HD.isHoliday(day.toDate()) || [6, 7].includes(day.isoWeekday())) {
      continue
    }
    genDaily({ Email, day }).forEach((v) => {
      console.log(Object.values(v).map(v => `"${v}"`).join(','))
    })
  }
}


if (require.main === module) {
  genYear({ year: '2019', Email: 'leo.li@eqworks.com' })
}
