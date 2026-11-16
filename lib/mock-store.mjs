import { ASSIGNED_WINDOWS, DEFAULT_ASSIGNED_WINDOW } from "./windows.mjs";

const ME_USER = {
  accountId: "mock-demo-user",
  displayName: "Demo User",
  emailAddress: "demo.user@example.com",
  avatarUrl: null,
};

const USERS = [
  ME_USER,
  {
    accountId: "mock-alex-example",
    displayName: "Alex Example",
    emailAddress: "alex@example.com",
    avatarUrl: null,
  },
  {
    accountId: "mock-sam-example",
    displayName: "Sam Example",
    emailAddress: "sam@example.com",
    avatarUrl: null,
  },
  {
    accountId: "mock-jordan-example",
    displayName: "Jordan Example",
    emailAddress: "jordan@example.com",
    avatarUrl: null,
  },
];

const PROJECTS = {
  DEMO: { key: "DEMO", name: "Demo Project", avatarUrl: null },
  SAMPLE: { key: "SAMPLE", name: "Sample Project", avatarUrl: null },
  MOCK: { key: "MOCK", name: "Mock Project", avatarUrl: null },
  FAKE: { key: "FAKE", name: "Fake Project", avatarUrl: null },
};

const PRIORITIES = {
  Highest: { id: "1", name: "Highest" },
  High: { id: "2", name: "High" },
  Medium: { id: "3", name: "Medium" },
  Low: { id: "4", name: "Low" },
  Lowest: { id: "5", name: "Lowest" },
};

const STATUSES = {
  Backlog: { name: "Backlog", category: "new", categoryName: "To Do" },
  "To Do": { name: "To Do", category: "new", categoryName: "To Do" },
  "In Progress": { name: "In Progress", category: "indeterminate", categoryName: "In Progress" },
  "In Review": { name: "In Review", category: "indeterminate", categoryName: "In Progress" },
  Done: { name: "Done", category: "done", categoryName: "Done" },
  Closed: { name: "Closed", category: "done", categoryName: "Done" },
};

function daysAgo(days, hours = 9) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hours, 15, 0, 0);
  return d.toISOString();
}

function clone(value) {
  return structuredClone(value);
}

function issue({
  key,
  id,
  summary,
  type,
  priority,
  status,
  project,
  assignee,
  reporter,
  created,
  updated,
  resolved = null,
  comments = [],
}) {
  return {
    key,
    id: String(id),
    summary,
    issueType: { name: type, iconUrl: null },
    priority: PRIORITIES[priority],
    status: STATUSES[status],
    project: PROJECTS[project],
    assignee: assignee ? clone(assignee) : null,
    reporter: clone(reporter),
    created,
    updated,
    resolved,
    comments: comments.map((c, i) => ({
      id: `${id}-c${i + 1}`,
      author: clone(c.author),
      created: c.created,
      body: c.body,
    })),
  };
}

function seedIssues() {
  const alex = USERS[1];
  const sam = USERS[2];
  const jordan = USERS[3];
  return [
    issue({
      key: "DEMO-12",
      id: 1012,
      summary: "Add a health check to the API gateway",
      type: "Story",
      priority: "High",
      status: "In Progress",
      project: "DEMO",
      assignee: ME_USER,
      reporter: alex,
      created: daysAgo(9),
      updated: daysAgo(0, 14),
      comments: [
        { author: alex, created: daysAgo(8), body: "Please keep this scoped to the public routes." },
        { author: ME_USER, created: daysAgo(1), body: "Drafted the probe; adding a lag threshold next." },
      ],
    }),
    issue({
      key: "DEMO-18",
      id: 1018,
      summary: "Document the local dashboard setup for new teammates",
      type: "Task",
      priority: "Medium",
      status: "To Do",
      project: "DEMO",
      assignee: ME_USER,
      reporter: ME_USER,
      created: daysAgo(4),
      updated: daysAgo(2),
    }),
    issue({
      key: "DEMO-21",
      id: 1021,
      summary: "Investigate intermittent 429s from the search API",
      type: "Bug",
      priority: "Highest",
      status: "In Review",
      project: "DEMO",
      assignee: sam,
      reporter: ME_USER,
      created: daysAgo(6),
      updated: daysAgo(0, 11),
      comments: [{ author: sam, created: daysAgo(1), body: "Looks like a burst of unpaginated queries." }],
    }),
    issue({
      key: "SAMPLE-7",
      id: 2007,
      summary: "Fix timezone on weekly status charts",
      type: "Bug",
      priority: "High",
      status: "In Progress",
      project: "SAMPLE",
      assignee: ME_USER,
      reporter: jordan,
      created: daysAgo(11),
      updated: daysAgo(0, 16),
    }),
    issue({
      key: "SAMPLE-14",
      id: 2014,
      summary: "Draft acceptance criteria for the intake form",
      type: "Story",
      priority: "Medium",
      status: "Backlog",
      project: "SAMPLE",
      assignee: null,
      reporter: ME_USER,
      created: daysAgo(15),
      updated: daysAgo(7),
    }),
    issue({
      key: "SAMPLE-19",
      id: 2019,
      summary: "Tighten validation on eligibility dates",
      type: "Task",
      priority: "Low",
      status: "To Do",
      project: "SAMPLE",
      assignee: ME_USER,
      reporter: alex,
      created: daysAgo(3),
      updated: daysAgo(3),
    }),
    issue({
      key: "MOCK-4",
      id: 3004,
      summary: "Spike: can we reuse the existing auth middleware?",
      type: "Spike",
      priority: "Medium",
      status: "In Progress",
      project: "MOCK",
      assignee: ME_USER,
      reporter: ME_USER,
      created: daysAgo(5),
      updated: daysAgo(1),
    }),
    issue({
      key: "MOCK-9",
      id: 3009,
      summary: "Add a filter for assigned vs reported tickets",
      type: "Story",
      priority: "High",
      status: "To Do",
      project: "MOCK",
      assignee: jordan,
      reporter: ME_USER,
      created: daysAgo(8),
      updated: daysAgo(2),
    }),
    issue({
      key: "MOCK-11",
      id: 3011,
      summary: "Write a demo dataset for offline UI review",
      type: "Task",
      priority: "Low",
      status: "Done",
      project: "MOCK",
      assignee: ME_USER,
      reporter: ME_USER,
      created: daysAgo(6),
      updated: daysAgo(3),
      resolved: daysAgo(3),
      comments: [{ author: ME_USER, created: daysAgo(3), body: "Sample cards are in mock mode now." }],
    }),
    issue({
      key: "FAKE-3",
      id: 4003,
      summary: "Replace the deprecated issue search endpoint",
      type: "Task",
      priority: "Highest",
      status: "In Review",
      project: "FAKE",
      assignee: ME_USER,
      reporter: sam,
      created: daysAgo(12),
      updated: daysAgo(0, 10),
    }),
    issue({
      key: "FAKE-8",
      id: 4008,
      summary: "Add a comment box to the ticket drawer",
      type: "Story",
      priority: "Medium",
      status: "To Do",
      project: "FAKE",
      assignee: ME_USER,
      reporter: alex,
      created: daysAgo(2),
      updated: daysAgo(2),
    }),
    issue({
      key: "DEMO-6",
      id: 1006,
      summary: "Ship the first cut of the personal board",
      type: "Story",
      priority: "High",
      status: "Done",
      project: "DEMO",
      assignee: ME_USER,
      reporter: ME_USER,
      created: daysAgo(20),
      updated: daysAgo(5),
      resolved: daysAgo(5),
    }),
    issue({
      key: "SAMPLE-2",
      id: 2002,
      summary: "Archive the old weekly export script",
      type: "Task",
      priority: "Lowest",
      status: "Closed",
      project: "SAMPLE",
      assignee: ME_USER,
      reporter: jordan,
      created: daysAgo(40),
      updated: daysAgo(28),
      resolved: daysAgo(28),
    }),
    issue({
      key: "MOCK-1",
      id: 3001,
      summary: "Kickoff notes for the grants workspace",
      type: "Task",
      priority: "Low",
      status: "Done",
      project: "MOCK",
      assignee: sam,
      reporter: ME_USER,
      created: daysAgo(50),
      updated: daysAgo(35),
      resolved: daysAgo(35),
    }),
    issue({
      key: "FAKE-1",
      id: 4001,
      summary: "Choose a localhost port and bind address",
      type: "Task",
      priority: "Medium",
      status: "Closed",
      project: "FAKE",
      assignee: ME_USER,
      reporter: ME_USER,
      created: daysAgo(45),
      updated: daysAgo(22),
      resolved: daysAgo(22),
    }),
  ];
}

const TRANSITIONS = {
  new: [
    { id: "11", name: "Start work", to: STATUSES["In Progress"] },
    { id: "21", name: "Mark done", to: STATUSES.Done },
  ],
  indeterminate: [
    { id: "31", name: "Send back to To Do", to: STATUSES["To Do"] },
    { id: "41", name: "Mark done", to: STATUSES.Done },
    {
      id: "91",
      name: "Close with resolution",
      to: STATUSES.Closed,
      requiredFields: ["resolution"],
    },
  ],
  done: [
    { id: "51", name: "Reopen", to: STATUSES["To Do"] },
    { id: "61", name: "Resume work", to: STATUSES["In Progress"] },
  ],
};

// Fake "assigned to the demo user" times, in hours ago, so the recently-assigned view is testable.
const ASSIGNED_HOURS_AGO = {
  "DEMO-12": 5,
  "SAMPLE-7": 20,
  "FAKE-8": 50,
  "SAMPLE-19": 72,
  "MOCK-4": 240,
  "FAKE-3": 480,
};

export function createMockStore(baseUrl = "https://your-site.atlassian.net") {
  const issues = seedIssues();
  for (const item of issues) {
    const hours = ASSIGNED_HOURS_AGO[item.key];
    item.assignedAt = hours ? new Date(Date.now() - hours * 3600 * 1000).toISOString() : null;
  }

  function publicIssue(issue) {
    const { comments, assignedAt, ...rest } = issue;
    return { ...clone(rest), url: `${baseUrl}/browse/${issue.key}` };
  }

  function find(key) {
    return issues.find((issue) => issue.key.toLowerCase() === String(key).toLowerCase());
  }

  function recentlyAssignedTo(issue, since) {
    return (
      issue.assignee?.accountId === ME_USER.accountId &&
      Boolean(issue.assignedAt) &&
      Date.parse(issue.assignedAt) >= since
    );
  }

  function list({
    includeDone = false,
    assignedWithin = DEFAULT_ASSIGNED_WINDOW,
    onlyRecentlyAssigned = false,
  } = {}) {
    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
    const since = Date.now() - ASSIGNED_WINDOWS[assignedWithin].ms;
    const result = issues
      .filter((issue) => {
        if (includeDone) return true;
        if (issue.status.category !== "done") return true;
        if (!issue.resolved) return true;
        return Date.parse(issue.resolved) >= cutoff;
      })
      .filter((issue) => !onlyRecentlyAssigned || recentlyAssignedTo(issue, since))
      .sort((a, b) => Date.parse(b.updated) - Date.parse(a.updated))
      .map((issue) => {
        const recent = recentlyAssignedTo(issue, since);
        return { ...publicIssue(issue), newToMe: recent, assignedAt: recent ? issue.assignedAt : null };
      });
    return { issues: result, assignedAtSkipped: 0, warning: null };
  }

  function get(key) {
    const issue = find(key);
    if (!issue) return null;
    return {
      ...publicIssue(issue),
      comments: clone(issue.comments),
    };
  }

  function transitions(key) {
    const issue = find(key);
    if (!issue) return null;
    return clone(TRANSITIONS[issue.status.category] || []);
  }

  function applyTransition(key, transitionId) {
    const issue = find(key);
    if (!issue) return { error: "not_found", message: `Issue ${key} was not found.` };
    const transition = (TRANSITIONS[issue.status.category] || []).find((t) => t.id === String(transitionId));
    if (!transition) {
      return {
        error: "invalid_transition",
        message: `Transition ${transitionId} is not available from ${issue.status.name}.`,
      };
    }
    if (transition.requiredFields?.length) {
      return {
        error: "required_fields",
        message:
          `"${transition.name}" needs extra fields (${transition.requiredFields.join(", ")}) that this dashboard does not collect. Open the ticket in Jira to complete it.`,
        requiredFields: transition.requiredFields,
      };
    }
    issue.status = clone(transition.to);
    issue.updated = new Date().toISOString();
    if (issue.status.category === "done") {
      issue.resolved = issue.updated;
    } else {
      issue.resolved = null;
    }
    return { issue: publicIssue(issue) };
  }

  function update(key, fields) {
    const issue = find(key);
    if (!issue) return { error: "not_found", message: `Issue ${key} was not found.` };
    if (fields.summary != null) {
      const summary = String(fields.summary).trim();
      if (!summary) return { error: "invalid", message: "Summary cannot be empty." };
      issue.summary = summary;
    }
    if (fields.priority != null) {
      const priority = PRIORITIES[fields.priority] || Object.values(PRIORITIES).find((p) => p.id === String(fields.priority));
      if (!priority) return { error: "invalid", message: `Unknown priority: ${fields.priority}` };
      issue.priority = clone(priority);
    }
    if (Object.prototype.hasOwnProperty.call(fields, "assigneeAccountId")) {
      const previousAssignee = issue.assignee?.accountId || null;
      if (fields.assigneeAccountId === null || fields.assigneeAccountId === "") {
        issue.assignee = null;
      } else {
        const user = USERS.find((u) => u.accountId === fields.assigneeAccountId);
        if (!user) return { error: "invalid", message: "That user is not assignable in the demo data." };
        issue.assignee = clone(user);
      }
      const nowMine = issue.assignee?.accountId === ME_USER.accountId;
      if (!nowMine) issue.assignedAt = null;
      else if (previousAssignee !== ME_USER.accountId) issue.assignedAt = new Date().toISOString();
    }
    issue.updated = new Date().toISOString();
    return { issue: publicIssue(issue) };
  }

  function addComment(key, body) {
    const issue = find(key);
    if (!issue) return { error: "not_found", message: `Issue ${key} was not found.` };
    const text = String(body || "").trim();
    if (!text) return { error: "invalid", message: "Comment cannot be empty." };
    const comment = {
      id: `${issue.id}-c${issue.comments.length + 1}-${Date.now()}`,
      author: clone(ME_USER),
      created: new Date().toISOString(),
      body: text,
    };
    issue.comments.push(comment);
    issue.updated = comment.created;
    return { comment };
  }

  function searchAssignable({ query = "" } = {}) {
    const q = String(query || "").trim().toLowerCase();
    return USERS.filter((user) => {
      if (!q) return true;
      return (
        user.displayName.toLowerCase().includes(q) ||
        user.emailAddress.toLowerCase().includes(q)
      );
    }).map((user) => clone(user));
  }

  return {
    me: () => clone(ME_USER),
    list,
    get,
    transitions,
    applyTransition,
    update,
    addComment,
    searchAssignable,
  };
}
