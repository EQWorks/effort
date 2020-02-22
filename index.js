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

const HOURS = 8 // default daily work hours per user
const START = '09:00:00' // default work start
const TZ = 'America/Toronto'
const HD = new Holidays('CA', 'ON')


const genError = () => 1 + (Math.random() * 2 - 1) * 0.111

const redistributePortion = ({ tasks, margin }) => {
  const rt = { ...tasks }
  rt.Development = rt.Development * margin
  const rem = (1 - rt.Development) / 3
  ;['Research/Design', 'QA/Maintenance', 'Admin/Ops'].forEach((t) => {
    rt[t] = rem
  })
  return rt
}

const genDaily = ({
  Email,
  day,
  hours = HOURS,
  start = START,
  projects = {
    LOCUS: 1,
    ATOM: 0,
  },
  tasks = {
    Development: 0.7,
    'Research/Design': 0.1,
    'QA/Maintenance': 0.1,
    'Admin/Ops': 0.1,
  },
}) => {
  const startDate = (day ? moment.tz(day, TZ) : moment.tz(TZ)).format('YYYY-MM-DD')
  let startTime = moment.tz(`${startDate} ${start}`, TZ).utc()
  const durations = {}

  shuffle(Object.entries(projects)).filter(([, pportion]) => pportion > 0).forEach(([Project, pportion]) => {
    shuffle(Object.entries(tasks)).filter(([, portion]) => portion > 0).forEach(([Task, portion]) => {
      // per-task, per-day error
      const err = genError()
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

const logHeader = () => {
  console.log(COLUMNS.map(c => `"${c}"`).join(','))
}

const genRange = ({
  start,
  end,
  Email,
  vacations = [],
  tasks = {
    Development: 0.7,
    'Research/Design': 0.1,
    'QA/Maintenance': 0.1,
    'Admin/Ops': 0.1,
  },
}) => {
  const range = moment.range(
    moment.tz(start, TZ).startOf('day'),
    moment.tz(end, TZ).endOf('day'),
  )
  const vacays = vacations.map(({ start, end }) => moment.range(
    moment.tz(start, TZ).startOf('day'),
    moment.tz(end, TZ).endOf('day'),
  ))
  // per-range estimation error to redistribute task portions
  const margin = genError()
  const rt = redistributePortion({ tasks, margin })

  for (let day of range.by('day')) {
    // skip weekends and public holidays
    if (HD.isHoliday(day.toDate()) || [6, 7].includes(day.isoWeekday())) {
      continue
    }
    // skip given vacation days
    if (vacays.find(r => r.contains(day))) {
      continue
    }
    genDaily({ Email, day, tasks: rt }).forEach((v) => {
      console.log(Object.values(v).map(v => `"${v}"`).join(','))
    })
  }
}

if (require.main === module) {
  const peepo = []
  logHeader()
  peepo.forEach(p => { genRange(p) })
}
