import fs from 'fs';
import path from 'path';

const SESSION_FILE = path.join(process.cwd(), 'sessions.json');

// Initialize sessions in-memory
let sessions = {};

// Load sessions from file if it exists
if (fs.existsSync(SESSION_FILE)) {
  try {
    const rawData = fs.readFileSync(SESSION_FILE, 'utf8');
    sessions = JSON.parse(rawData);
  } catch (err) {
    console.error('Failed to load session file, starting with empty sessions:', err);
    sessions = {};
  }
}

// Save sessions to disk
function persistSessions() {
  try {
    fs.writeFileSync(SESSION_FILE, JSON.stringify(sessions, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to write session file:', err);
  }
}

export const STATES = {
  DISCOVERY: 'DISCOVERY',
  COLLECTING_NAME: 'COLLECTING_NAME',
  COLLECTING_PHONE: 'COLLECTING_PHONE',
  COLLECTING_LOCATION: 'COLLECTING_LOCATION',
  AWAITING_CONFIRMATION: 'AWAITING_CONFIRMATION',
  ORDER_COMPLETED: 'ORDER_COMPLETED'
};

export function getSession(userId) {
  if (!sessions[userId]) {
    sessions[userId] = {
      userId,
      state: STATES.DISCOVERY,
      history: [],
      order: {
        nom: null,
        telephone: null,
        wilaya_commune: null,
        produits: [],
        total: 0,
        langue: 'fr'
      },
      produits: [],
      config: null,
      token: null,
      lastInteraction: new Date().toISOString()
    };
    persistSessions();
  }
  return sessions[userId];
}

export function saveSession(userId, data) {
  sessions[userId] = {
    ...sessions[userId],
    ...data,
    lastInteraction: new Date().toISOString()
  };
  persistSessions();
}

export function resetSession(userId) {
  sessions[userId] = {
    userId,
    state: STATES.DISCOVERY,
    history: [],
    order: {
      nom: null,
      telephone: null,
      wilaya_commune: null,
      produits: [],
      total: 0,
      langue: 'fr'
    },
    produits: [],
    config: null,
    token: null,
    lastInteraction: new Date().toISOString()
  };
  persistSessions();
  return sessions[userId];
}

export function updateSessionState(userId, state) {
  const session = getSession(userId);
  session.state = state;
  persistSessions();
}

export function addToHistory(userId, role, content) {
  const session = getSession(userId);
  session.history.push({ role, content });
  
  // Cap history size to prevent context window bloat (keep last 30 messages)
  if (session.history.length > 30) {
    session.history = session.history.slice(-30);
  }
  persistSessions();
}

export function getHistory(userId) {
  const session = getSession(userId);
  return session.history;
}
