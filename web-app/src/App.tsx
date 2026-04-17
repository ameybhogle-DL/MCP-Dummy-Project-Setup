import { useState, useEffect, useRef } from 'react'
import { Send, Plus, RefreshCcw, Database, Zap, Lock, LogOut } from 'lucide-react'
import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js"
import ReactMarkdown from 'react-markdown'
import './App.css'

const API_URL = "http://localhost:4000"
const MCP_URL = "http://localhost:3001"
// Toggle visibility of the legacy/direct DB chat panel
const SHOW_LEGACY = false

// --- Components ---

/**
 * Typewriter + Markdown Renderer
 * Performs character-by-character animation and renders Markdown for readability.
 */
const TypewriterMarkdown = ({ content }: { content: string }) => {
  const [displayed, setDisplayed] = useState("")
  const [index, setIndex] = useState(0)

  useEffect(() => {
    if (index < content.length) {
      const timeout = setTimeout(() => {
        setDisplayed(prev => prev + content[index])
        setIndex(prev => prev + 1)
      }, 15) // Adjust speed here index
      return () => clearTimeout(timeout)
    }
  }, [index, content])

  return (
    <div className="markdown-content">
      <ReactMarkdown>{displayed}</ReactMarkdown>
    </div>
  )
}

// --- Main App ---

interface Message {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | null;
  tool_calls?: any[];
  tool_call_id?: string;
  isNew?: boolean; // To trigger typing
}

interface AssistantState {
  messages: Message[];
  input: string;
  loading: boolean;
  status: string;
}

function App() {
  const [token, setToken] = useState<string | null>(sessionStorage.getItem('jwtToken'))
  const [password, setPassword] = useState("")
  const [authError, setAuthError] = useState("")

  const [projects, setProjects] = useState<any[]>([])
  const [projectName, setProjectName] = useState("")
  const [editingNames, setEditingNames] = useState<Record<string, string>>({})
  const [lastUpdatedId, setLastUpdatedId] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null)

  const [modern, setModern] = useState<AssistantState>({
    messages: [{ role: 'system', content: 'Modern MCP Assistant' }],
    input: "",
    loading: false,
    status: ""
  })

  const [legacy, setLegacy] = useState<AssistantState>({
    messages: [{ role: 'system', content: 'Legacy Direct Assistant' }],
    input: "",
    loading: false,
    status: ""
  })

  const mcpClient = useRef<Client | null>(null)

  // 1. Auth Logic
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setAuthError("")
    try {
      const res = await fetch(`${API_URL}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password })
      })
      const data = await res.json()
      if (res.ok) {
        sessionStorage.setItem('jwtToken', data.token)
        setToken(data.token)
      } else {
        setAuthError(data.error || "Login failed")
      }
    } catch (err) {
      setAuthError("Server unreachable")
    }
  }

  const handleLogout = () => {
    sessionStorage.removeItem('jwtToken')
    setToken(null)
  }

  // 2. Fetch Projects (Protected)
  const fetchProjects = async () => {
    if (!token) return
    try {
      const res = await fetch(`${API_URL}/projects`, {
        headers: { "Authorization": `Bearer ${token}` }
      })
      if (res.status === 401) return handleLogout()
      const data = await res.json()
      setProjects(data)
    } catch (err) {
      console.error("Fetch projects failed", err)
    }
  }

// Poll projects every 5 seconds so external updates (via MCP) are reflected
useEffect(() => {
  if (!token) return;
  fetchProjects();
  const id = setInterval(fetchProjects, 5000);
  return () => clearInterval(id);
}, [token]);

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!projectName || !token) return
    await fetch(`${API_URL}/projects`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`
      },
      body: JSON.stringify({ projectName })
    })
    setProjectName("")
    fetchProjects()
  }

  const initMCP = async () => {
    if (mcpClient.current) return
    const transport = new SSEClientTransport(new URL(`${MCP_URL}/sse`))
    const client = new Client({ name: "web-chatbot", version: "1.0.0" }, { capabilities: {} })
    await client.connect(transport)
    mcpClient.current = client
  }

  // 3. Unified Chat Logic (Protected)
  const sendMessage = async (type: 'modern' | 'legacy') => {
    const state = type === 'modern' ? modern : legacy;
    const setState = type === 'modern' ? setModern : setLegacy;

    if (!state.input || !token) return

    const userMsg: Message = { role: 'user', content: state.input }
    const history = [...state.messages, userMsg]

    setState(s => ({ ...s, input: "", messages: history, loading: true, status: "Processing..." }))

    try {
      let endpoint = type === 'modern' ? `${API_URL}/chat` : `${API_URL}/chat-direct`;

      // Clean messages for API (remove UI-only properties like 'isNew')
      const cleanedMessages = history.map(m => {
        const cleaned: any = { role: m.role, content: m.content };
        if (m.tool_calls) cleaned.tool_calls = m.tool_calls;
        if (m.tool_call_id) cleaned.tool_call_id = m.tool_call_id;
        return cleaned;
      });

      const payload: any = { messages: cleanedMessages };

      console.log(`📤 Sending to ${endpoint}:`, payload);

      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      console.log(`📥 Response status: ${res.status}`);

      if (res.status === 401) {
        console.error('Unauthorized - clearing token');
        return handleLogout();
      }

      if (!res.ok) {
        const errorText = await res.text();
        console.error(`❌ HTTP ${res.status}:`, errorText);
        throw new Error(`HTTP ${res.status}: ${errorText}`);
      }

      const data = await res.json();
      console.log('Response data:', data);

      const aiMsg = data.choices[0].message;
      let finalHistory = [...history, { ...aiMsg, isNew: true }];

      setState(s => ({ ...s, messages: finalHistory, loading: false }));
      fetchProjects();
    } catch (err: any) {
      console.error('Chat error:', err);
      setState(s => ({ ...s, loading: false, messages: [...history, { role: 'assistant', content: `Error: ${err?.message || 'Architecture offline.'}`, isNew: true }] }));
    }
  }

  // --- RENDERING ---

  if (!token) {
    return (
      <div className="auth-overlay">
        <div className="glass-card login-box">
          <div className="auth-header">
            <Lock size={32} />
            <h2>Divergent Insights</h2>
            <p>Enter password to access dashboard</p>
          </div>
          <form onSubmit={handleLogin}>
            <input
              type="password"
              placeholder="Password..."
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="auth-input"
            />
            {authError && <p className="auth-error">{authError}</p>}
            <button className="primary" type="submit">Unlock Dashboard</button>
          </form>
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <header>
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px', position: 'relative' }}>
          <h1>Divergent Insights</h1>
          <button className="logout-btn" onClick={handleLogout} title="Logout">
            <LogOut size={18} />
          </button>
        </div>
        <p className="subtitle">Testing Environment</p>
      </header>

      <div className="layout">
        <main className="glass-card">
          <div className="section-header">
            <h2>Project Management Hub</h2>
            <button onClick={fetchProjects} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-secondary)' }}>
              <RefreshCcw size={18} />
            </button>
          </div>
          <div className="table-wrapper">
            <table>
              <thead>
                  <tr>
                    <th>#</th>
                    <th>Project Name</th>
                    <th>Status</th>
                    <th>Created At</th>
                    <th>Updated</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {projects.map((p, idx) => (
                    <tr key={p._id} title={p._id} className={p._id === lastUpdatedId ? 'recent-updated' : ''}>
                      <td>{idx + 1}</td>
                      <td>
                        <input
                          value={editingNames[p._id] ?? p.projectName}
                          onChange={(e) => setEditingNames(prev => ({ ...prev, [p._id]: e.target.value }))}
                          onBlur={async (e) => {
                            const newName = (editingNames[p._id] ?? p.projectName).trim();
                            if (newName && newName !== p.projectName) {
                              try {
                                const res = await fetch(`${API_URL}/projects/${p._id}`, {
                                  method: 'PATCH',
                                  headers: {
                                    'Content-Type': 'application/json',
                                    'Authorization': `Bearer ${token}`
                                  },
                                  body: JSON.stringify({ projectName: newName })
                                });
                                if (res.ok) {
                                  const updated = await res.json();
                                  setLastUpdatedId(p._id);
                                  const now = new Date().toLocaleTimeString();
                                  setLastUpdatedAt(now);
                                  fetchProjects();
                                  // clear highlight after a few seconds
                                  setTimeout(() => { setLastUpdatedId(null); setLastUpdatedAt(null); }, 8000);
                                } else if (res.status === 401) {
                                  handleLogout();
                                } else {
                                  console.error('Failed to update name', await res.text());
                                }
                              } catch (err) {
                                console.error('Update error', err);
                              }
                            }
                          }}
                          style={{ width: '100%', border: 'none', background: 'transparent', color: 'inherit' }}
                        />
                      </td>
                      <td><span className="status-badge">{p.status}</span></td>
                      <td>{new Date(p.createdAt).toLocaleDateString()}</td>
                      <td>{p.updatedAt ? new Date(p.updatedAt).toLocaleString() : ''}</td>
                      <td>
                        <select
                          defaultValue={p.status}
                          onChange={async (e) => {
                            const newStatus = e.target.value;
                            try {
                              const res = await fetch(`${API_URL}/projects/${p._id}`, {
                                method: 'PATCH',
                                headers: {
                                  'Content-Type': 'application/json',
                                  'Authorization': `Bearer ${token}`
                                },
                                body: JSON.stringify({ status: newStatus })
                              });
                              if (res.ok) {
                                setLastUpdatedId(p._id);
                                setLastUpdatedAt(new Date().toLocaleTimeString());
                                fetchProjects();
                                setTimeout(() => { setLastUpdatedId(null); setLastUpdatedAt(null); }, 8000);
                              } else if (res.status === 401) {
                                handleLogout();
                              } else {
                                console.error('Failed to update status', await res.text());
                              }
                            } catch (err) {
                              console.error('Update error', err);
                            }
                          }}
                        >
                          <option>Draft</option>
                          <option>In Progress</option>
                          <option>Completed</option>
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
            </table>
          </div>
        </main>

        <aside className="glass-card">
          <div className="section-header">
            <h2>Manual Entry</h2>
          </div>
          <form onSubmit={handleManualSubmit}>
            <div className="form-group">
              <label>Project Name</label>
              <input
                type="text"
                placeholder="New project..."
                value={projectName}
                onChange={(e) => setProjectName(e.target.value)}
              />
            </div>
            <button className="primary" type="submit">
              <Plus size={18} /> Add Project
            </button>
          </form>
        </aside>
      </div>

      <div className="dual-chat-container">
        {/* Modern Assistant */}
        <div className="chat-panel">
          <div className="chat-panel-header mcp">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Zap size={16} /> Modern Architecture
            </div>
            <span className="arch-badge">MCP BRIDGE</span>
          </div>
          <div className="chat-messages">
            {modern.messages.filter(m => m.role !== 'system' && m.content).map((m, i) => (
              <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'assistant'}`}>
                {m.role === 'assistant' && m.isNew ? (
                  <TypewriterMarkdown content={m.content!} />
                ) : (
                  <ReactMarkdown>{m.content!}</ReactMarkdown>
                )}
              </div>
            ))}
            {modern.loading && <div className="msg assistant" style={{ fontStyle: 'italic', opacity: 0.7 }}>{modern.status}</div>}
          </div>
          <div className="chat-input-row">
            <input
              className="mini-input"
              placeholder="Test the bridge..."
              value={modern.input}
              onChange={(e) => setModern(s => ({ ...s, input: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage('modern')}
            />
            <button className="primary" style={{ width: '42px' }} onClick={() => sendMessage('modern')}>
              <Send size={16} />
            </button>
          </div>
        </div>

        {/* Legacy Assistant (hidden when SHOW_LEGACY=false) */}
        {SHOW_LEGACY && (
        <div className="chat-panel">
          <div className="chat-panel-header direct">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Database size={16} /> Legacy Architecture
            </div>
            <span className="arch-badge">DIRECT DB</span>
          </div>
          <div className="chat-messages">
            {legacy.messages.filter(m => m.role !== 'system' && m.content).map((m, i) => (
              <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'assistant legacy'}`}>
                {m.role === 'assistant' && m.isNew ? (
                  <TypewriterMarkdown content={m.content!} />
                ) : (
                  <ReactMarkdown>{m.content!}</ReactMarkdown>
                )}
              </div>
            ))}
            {legacy.loading && <div className="msg assistant legacy" style={{ fontStyle: 'italic', opacity: 0.7 }}>Directly accessing DB...</div>}
          </div>
          <div className="chat-input-row">
            <input
              className="mini-input"
              placeholder="Test direct access..."
              value={legacy.input}
              onChange={(e) => setLegacy(s => ({ ...s, input: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && sendMessage('legacy')}
            />
            <button className="primary" style={{ width: '42px', backgroundColor: 'var(--legacy)' }} onClick={() => sendMessage('legacy')}>
              <Send size={16} />
            </button>
          </div>
        </div>
        )}
      </div>
    </div>
  )
}

export default App
