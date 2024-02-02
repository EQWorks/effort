const shuffle = require("lodash.shuffle")
const Holidays = require("date-holidays")
const Moment = require("moment-timezone")
const { extendMoment } = require("moment-range")
const moment = extendMoment(Moment)
const fs = require("fs")
const csvParser = require("csv-parser")
const { Command } = require("commander")
const program = new Command()

const { loadPeepo } = require("./peepo")
const humi = require("./humi")
const timeEntries = require("./time-entries")


program
    .name("effor-util")
    .description("Effort CLI to work with project time effort")
    .version("2.0.0")

const COLUMNS = Object.freeze([
    // 'User',
    "Email",
    // 'Client',
    "Project",
    "Task",
    // 'Description',
    // 'Billable',
    "Start date", // YYYY-MM-DD
    "Start time", // HH:mm:ss
    "Duration", // HH:mm:ss
    // 'Tags',
])

const HOURS = 8 // default daily work hours per user
const START = "09:00:00" // default work start
const TZ = "America/Toronto"
const HD = new Holidays("CA", "ON")


const genError = () => 1 + (Math.random() * 2 - 1) * 0.111

const redistributePortion = ({ tasks, margin }) => {
    const rt = { ...tasks }
    rt.Development = rt.Development * margin
    const rem = (1 - rt.Development) / 3
    ;["Research/Design", "QA/Maintenance", "Admin/Ops"].forEach((t) => {
        rt[t] = rem
    })
    return rt
}

const genDaily = ({
    Email,
    day,
    hours = HOURS,
    start = START,
    togglProject = "Engineering",
    tasks = {
        Development: 0.7,
        "Research/Design": 0.1,
        "QA/Maintenance": 0.1,
        "Admin/Ops": 0.1,
    },
}) => {
    const startDate = (day ? moment.tz(day, TZ) : moment.tz(TZ)).format("YYYY-MM-DD")
    let startTime = moment.tz(`${startDate} ${start}`, TZ).utc()
    const durations = {}

    shuffle(Object.entries(tasks)).filter(([, portion]) => portion > 0).forEach(([Task, portion]) => {
    // per-task, per-day error
        const err = genError()
        const d = moment.duration(hours * portion * err, "hours")
        durations[`${togglProject}::${Task}`] = {
            startTime: startTime.format("HH:mm:ss"),
            Duration: moment.utc(d.asMilliseconds()).format("HH:mm:ss"),
        }
        startTime.add(d)
    })

    const rows = Object.entries(durations).map(([key, { startTime, Duration }]) => ({
        Email,
        Project: key.split("::")[0],
        Task: key.split("::")[1],
        "Start Date": startDate,
        "Start Time": startTime,
        Duration,
    }))

    return rows
}

const getHeader = () => {
    return COLUMNS.map(c => `"${c}"`).join(",") + "\n"
}

const isVacay = ({ end }) => end.length === 10

const genRange = ({
    after, // boundary start (inclusive)
    before, // boundary end (inclusive)
    start,
    end, // optional
    Email,
    vacations = [],
    togglProject = "Engineering",
    tasks = {
        Development: 0.7,
        "Research/Design": 0.1,
        "QA/Maintenance": 0.1,
        "Admin/Ops": 0.1,
    },
    companyHolidays = [], // list of strings in YYYY-MM-DD format
    offWeekDays, // ISO weekdays that are off
    offWeekDaysDurations, // ISO date ranges (YYYY-MM-DD to YYYY-MM-DD) to apply offWeekDays
}) => {
    const bStart = moment.tz(after, TZ).startOf("day")
    const bEnd = moment.tz(before, TZ).startOf("day")
    let pStart = moment.tz(start, TZ).startOf("day")
    let pEnd = moment.tz(end || before, TZ).endOf("day")
    if (pEnd.isBefore(bStart) || pStart.isAfter(bEnd)) {
        return // no gen for this person, since started or ended out of boundary range
    }
    let rows = ""
    // fit start/end to boundary
    if (bStart.isAfter(pStart)) {
        pStart = bStart
    }
    if (bEnd.isBefore(pEnd)) {
        pEnd = bEnd
    }
    const range = moment.range(pStart, pEnd)
    // vacation ranges
    const vacays = vacations.filter(isVacay).map(({ start, end }) => moment.range(
        moment.tz(start, TZ).startOf("day"),
        moment.tz(end, TZ).endOf("day"),
    ))
    // off weekdays ranges
    const owdDurations = (offWeekDaysDurations || "").split(",").map((d) => d.split("to").map((d) => d.trim()))
    const owds = owdDurations.map(([start, end]) => moment.range(
        moment.tz(start, TZ).startOf("day"),
        moment.tz(end, TZ).endOf("day"),
    ))
    // per-range estimation error to redistribute task portions
    const margin = genError()
    const rt = redistributePortion({ tasks, margin })

    for (let day of range.by("day")) {
    // skip weekends and public holidays
        if (HD.isHoliday(day.toDate()) || [6, 7].includes(day.isoWeekday())) {
            continue
        }
        // skip company holidays
        if (companyHolidays.includes(day.format("YYYY-MM-DD"))) {
            continue
        }
        // skip fixed off days
        const isOffWD = (offWeekDays || "").split(",").filter(d => d).map(d => parseInt(d)).includes(day.isoWeekday())
        if (owds.find(r => r.contains(day)) && isOffWD) {
            continue
        }
        // skip given vacation days
        if (vacays.find(r => r.contains(day))) {
            continue
        }
        const unavails = vacations
            .filter((v) => !isVacay(v))
            .filter(({ end }) => moment.tz(day, TZ).startOf("day").isSame(moment.tz(end, TZ).startOf("day")))

        rows = rows + genDaily({
            Email,
            day,
            tasks: rt,
            hours: HOURS - unavails.length,
            togglProject,
        }).map((v) => Object.values(v).map(v => `"${v}"`).join(",")).join("\n")
      + "\n"
    }

    return rows
}

const generateReport = ({ after, before, peepoSheet, timeOffSheet, department, togglProject, outFilename,
    taskDistributionPct = [0.7, 0.1, 0.1, 0.1] }) => {

    Promise.all([
        loadPeepo(peepoSheet), // source from accounting team
        humi.loadTimeOffs(timeOffSheet, { department }),
    ]).then(([peepo, vacays]) => {

        let file = fs.createWriteStream(`${outFilename}`)
        file.write(getHeader())

        for (let i = 0; i < peepo.length; i++) {
            const p = peepo[i]

            file.write(genRange({
                after,
                before,
                ...p,
                vacations: vacays[p.Email.toLowerCase()],
                togglProject,
                tasks: {
                    Development: taskDistributionPct[0],
                    "Research/Design": taskDistributionPct[1],
                    "QA/Maintenance": taskDistributionPct[2],
                    "Admin/Ops": taskDistributionPct[3],
                },
                companyHolidays: [
                    // TODO: better range support, including half-day holidays
                    // '2021-12-24', // second half day-off
                    // from last year
                    "2022-01-01",
                    "2022-01-02",
                    // office closed
                    "2023-12-25",
                    "2023-12-26",
                    "2023-12-27",
                    "2023-12-28",
                    "2023-12-29",
                ],
            }))
        }

        // Close the last file
        file.close()

        // create the summary file
        const readableStream = fs.createReadStream(`${outFilename}`)

        // Create a writable stream for the output file
        const writableStream = fs.createWriteStream(`${outFilename}_summary.csv`)

        // Create a CSV parser
        const parser = csvParser()

        // Create a map to store the grouped data
        const groupedData = new Map()

        // Parse the input file and group the data
        readableStream
            .pipe(parser)
            .on("data", (data) => {
                const email = data.Email
                const project = data.Project
                const task = data.Task
                const duration = moment.duration(data.Duration)

                // Get the existing group for the email, project, and task
                let group = groupedData.get(email + project + task)

                // If the group does not exist, create a new one
                if (!group) {
                    group = {
                        email: email,
                        project: project,
                        task: task,
                        duration: moment.duration(0),
                    }

                    // Add the group to the map
                    groupedData.set(email + project + task, group)
                }

                // Add the duration to the group
                group.duration.add(duration)
            })
            .on("end", () => {
                // Write the grouped data to the output file
                writableStream.write("Email,Project,Task,Duration\n")
                for (const group of groupedData.values()) {
                    const durationFormatted = `${group.duration.asHours().toFixed()}:${moment.utc(group.duration.asMilliseconds()).format("mm:ss")}`
                    writableStream.write(
                        `${group.email},${group.project},${group.task},${durationFormatted}\n`
                    )
                }

                // Close the writable stream
                writableStream.end()
            })
    })
}

const adjustEffort = async ({ after, before, user, workspace, togglProject, percent }) => {

    console.log("getting workspace ...")
    const workspaceId = await timeEntries.getWorkspaceId(workspace)
    console.log("getting project ...")
    const projectId = await timeEntries.getProjectId(togglProject, workspaceId)

    console.log("getting user ...")
    // Get the user ID for the given email address
    const userId = await timeEntries.getUserId(user, workspaceId)

    const since = after
    const until = before
    console.log("getting time entries ...")
    const entries = await timeEntries.getTimeEntries(userId, since, until, workspaceId, projectId)

    const percentValue = parseFloat(percent) / 100.0

    console.log(`loaded ${entries.length} time entries`)
    console.log("updating time entries ...")
    for (let index = 0; index < entries.length; index++) {
        const timeEntry = entries[index]
        const endTime = moment.parseZone(timeEntry.start)
        endTime.add(timeEntry.seconds)
        await timeEntries.updateDuration(timeEntry, percentValue, endTime.tz(TZ).format(), workspaceId)
        break
    }
}

const deleteEffort = async ({ after, before, user, workspace, togglProject }) => {

    console.log("getting workspace ...")
    const workspaceId = await timeEntries.getWorkspaceId(workspace)
    console.log("getting project ...")
    const projectId = await timeEntries.getProjectId(togglProject, workspaceId)

    console.log("getting user ...")
    // Get the user ID for the given email address
    const userId = await timeEntries.getUserId(user, workspaceId)

    const since = after
    const until = before
    console.log("getting time entries ...")
    const entries = await timeEntries.getTimeEntries(userId, since, until, workspaceId, projectId)

    console.log(`loaded ${entries.length} time entries`)
    console.log("deleting time entries ...")
    for (let index = 0; index < entries.length; index++) {
        const timeEntry = entries[index]
        process.stdout.clearLine(0)
        process.stdout.cursorTo(0)
        process.stdout.write(`entry: ${index + 1} `)

        await timeEntries.deleteTimeEntry(timeEntry, workspaceId)
    }
}

function floatArrayParse(value) {
    return value.split(",").map(v => parseFloat(v))
}

if (require.main === module) {

    program.command("generate")
        .description("Generate time effor")
        .option("--after <string>", "boundary start date YYYY-MM-DD")
        .option("--before <string>", "boundary end date YYYY-MM-DDr")
        .option("--peepoSheet <string>", "CSV file with employees \"name,Email,start,end")
        .option("--timeOffSheet <string>", "CSV file with timeoff from Humi \"Name,Email,Employee Status,Department,Manager,Office,Date From,Date To,Count As,Period Overlap,Unit,Leave Type,Request Status,Date Approved,Description")
        .option("--togglProject <string>", "project name", "Engineering")
        .option("--department <string>", "department name", "Product & Development")
        .option("--outFilename <string>", "CSV output file", "timesheet.csv")
        .option("--taskDistributionPct <array>", "Task Distribution Percentage for \"Development, Research/Design, QA/Maintenance, Admin/Ops\"", floatArrayParse)
        .action(function () {
            generateReport(this.opts())
        })

    program.command("adjust")
        .description("Adjust time effor per user")
        .option("--user <string>", "user email")
        .option("--after <string>", "boundary start date YYYY-MM-DD")
        .option("--before <string>", "boundary end date YYYY-MM-DDr")
        .option("--togglProject <string>", "project name", "Engineering")
        .option("--percent <string>", "percent to adjust current entries 1-99%")
        .option("--workspace <string>", "workspace name", "EQ Dev")
        .action(function () {
            adjustEffort(this.opts())
        })

    program.command("delete")
        .description("Adjust time effor per user")
        .option("--user <string>", "user email")
        .option("--after <string>", "boundary start date YYYY-MM-DD")
        .option("--before <string>", "boundary end date YYYY-MM-DDr")
        .option("--togglProject <string>", "project name", "Engineering")
        .option("--workspace <string>", "workspace name", "EQ Dev")
        .action(function () {
            deleteEffort(this.opts())
        })

    program.parse()

}

