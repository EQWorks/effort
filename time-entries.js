// time-entries.js


const apiBase = "https://api.track.toggl.com/api/v9/"
const apiReportsBase = "https://api.track.toggl.com/reports/api/v3/"

async function fetchAPI(query, method, payload, urlBase = apiBase) {
    const headers = {
        "Authorization": `Basic ${Buffer.from(process.env.TOGGL_API_TOKEN + ":api_token").toString("base64")}`,
        "Content-Type": "application/json",
        "User-Agent": "EQ Automation",
    }

    const options = {
        method,
        headers,
    }

    if (payload) {
        options.body = JSON.stringify(payload)
    }


    let data
    const response = await fetch(urlBase + query, options)
    try {
        data = await response.json()
    } catch (error) {
        if (process.env.DEBUG) {
            console.error(error)
        }

    }

    return [data, response.status]
}

/**
 * Get all time entries for the given user ID since the given date.
 *
 * @param {number} userId The ID of the user.
 * @param {Date} since The date from which to get time entries.
 * @returns {Promise<Array<TogglTimeEntry>>} An array of Toggl time entries.
 */
async function getTimeEntries(userId, since, until, workspaceId, projectId) {

    const [response, status] = await fetchAPI(`workspace/${workspaceId}/search/time_entries `, "POST",
        { "start_date": since, "end_date": until, "page_size": 2000, "project_ids": [projectId], "user_ids": [userId] },
        apiReportsBase)


    if (status != 200) {
        throw new Error(`API call returned status ${status}`)
    }

    return response.map(data => data.time_entries).flat(1)
}


function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time))
}

/**
 * Update the duration of the given time entry to 10% of its original value.
 *
 * @param {TogglTimeEntry} timeEntry The time entry to update.
 * @returns {Promise<TogglTimeEntry>} The updated time entry.
 */
async function updateDuration(timeEntry, percentChange, endTimeString, workspaceId) {
    for (let index = 0; index < 5; index++) {
        const [, status] = await fetchAPI(`workspaces/${workspaceId}/time_entries/${timeEntry.id}}`,
            "POST",
            { "duration": parseInt(percentChange * timeEntry.seconds), "start": timeEntry.start, "stop": endTimeString })

        if (status == 200) {
            break
        } else if (status == 429) {
            //rate limited
            console.log("limited", timeEntry.id)
            await delay(3000)
        } else {
            console.log(`failed to update ${timeEntry.id}`)
            break
        }
    }

}

async function deleteTimeEntry(timeEntry, workspaceId) {

    for (let index = 0; index < 5; index++) {
        const [, status] = await fetchAPI(`workspaces/${workspaceId}/time_entries/${timeEntry.id}`,
            "DELETE")

        if (status == 200) {
            break
        } else if (status == 429) {
            //rate limited
            console.log("limited", timeEntry.id)
            await delay(5000)
        } else {
            console.log(`failed to delete ${timeEntry.id}`)
            break
        }
    }
}

async function getWorkspaceId(workspaceName) {

    const [response, status] = await fetchAPI("workspaces", "GET")

    if (status != 200) {
        throw new Error(`API call returned status ${status}`)
    }

    const found = response.find(workspace => workspace.name === workspaceName)
    if (!found) {
        throw new Error(`workspace ${workspaceName} not found`)
    }

    return found.id
}

async function getProjectId(togglProject, workspaceId) {
    const [response, status] = await fetchAPI(`workspaces/${workspaceId}/projects`)

    if (status != 200) {
        throw new Error(`API call returned status ${status}`)
    }

    const project = response.find(project => project.name === togglProject)
    if (!project) {
        throw new Error(`No project found with name ${togglProject}`)
    }

    return project.id
}


/**
 * Get the user ID for the given email address.
 *
 * @param {string} email The email address of the user.
 * @returns {Promise<number>} The ID of the user.
 */
async function getUserId(email, workspaceId) {
    const [users, status] = await fetchAPI(`workspaces/${workspaceId}/users`)

    if (status != 200) {
        throw new Error(`API call returned status ${status}`)
    }

    const user = users.find(user => user.email === email)
    if (!user) {
        throw new Error(`No user found with email address ${email}`)
    }
    return user.id
}

module.exports = {
    getTimeEntries,
    updateDuration,
    getUserId,
    getWorkspaceId,
    getProjectId,
    deleteTimeEntry,
}
