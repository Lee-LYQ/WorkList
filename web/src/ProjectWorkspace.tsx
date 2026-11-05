import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'
import { ArrowLeft, Check, ChevronDown, Clipboard, ExternalLink, Link2, LoaderCircle, Pencil, Plus, RotateCw, Search, Trash2, X } from 'lucide-react'
import './App.css'

type Item = { id: string; text: string; note: string; completed: boolean }
type TaskList = { id: string; title: string; items: Item[] }
type Project = { id: string; title: string; lists: TaskList[] }
type SavedProject = { id: string; title: string; token: string }
type ItemDraft = Partial<Pick<Item, 'text' | 'note'>>

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
const demoMode = import.meta.env.DEV && !supabase
const storageKey = 'worklist-projects-v1'
const demoSeed: Project[] = [
  {
    id: 'demo-library',
    title: 'Waverley Library',
    lists: [
      { id: 'demo-events', title: '活动安排', items: [
        { id: 'demo-item-1', text: '确认本周活动安排', note: '和前台核对场地时间', completed: true },
        { id: 'demo-item-2', text: '整理读书会材料', note: '打印新版讨论提纲', completed: false },
      ] },
      { id: 'demo-supplies', title: '物资准备', items: [
        { id: 'demo-item-3', text: '清点活动用品', note: '', completed: false },
      ] },
    ],
  },
  {
    id: 'demo-bookclub',
    title: '社区读书会',
    lists: [
      { id: 'demo-reading', title: '本月书单', items: [
        { id: 'demo-item-4', text: '收集成员推荐书目', note: '周五前汇总', completed: false },
      ] },
      { id: 'demo-hosting', title: '聚会准备', items: [] },
    ],
  },
]

function readToken() { return new URLSearchParams(window.location.hash.slice(1)).get('share') }
function makeShareUrl(token: string) {
  const url = new URL(window.location.href)
  url.hash = new URLSearchParams({ share: token }).toString()
  return url.toString()
}
function readSavedProjects(): SavedProject[] {
  try { return JSON.parse(localStorage.getItem(storageKey) ?? '[]') as SavedProject[] } catch { return [] }
}

export default function ProjectWorkspace() {
  const [token, setToken] = useState(readToken)
  const [project, setProject] = useState<Project | null>(null)
  const [demoProjects, setDemoProjects] = useState<Project[]>(() => {
    if (!demoMode) return []
    try { return JSON.parse(localStorage.getItem('worklist-demo-projects-v1') ?? 'null') as Project[] | null ?? demoSeed } catch { return demoSeed }
  })
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>(readSavedProjects)
  const [activeDemoId, setActiveDemoId] = useState<string | null>(null)
  const [selectedListId, setSelectedListId] = useState('')
  const [projectNameDraft, setProjectNameDraft] = useState('')
  const [listNameDraft, setListNameDraft] = useState('')
  const [newProjectName, setNewProjectName] = useState('')
  const [newListName, setNewListName] = useState('')
  const [newItemName, setNewItemName] = useState('')
  const [itemDrafts, setItemDrafts] = useState<Record<string, ItemDraft>>({})
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [editingProject, setEditingProject] = useState(false)
  const [editingListId, setEditingListId] = useState<string | null>(null)
  const [mobileListMenuOpen, setMobileListMenuOpen] = useState(false)
  const [listSearch, setListSearch] = useState('')
  const [loading, setLoading] = useState(Boolean(readToken()))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  const activeProject = token ? project : demoMode ? demoProjects.find((entry) => entry.id === activeDemoId) ?? null : project
  const activeList = activeProject?.lists.find((entry) => entry.id === selectedListId) ?? activeProject?.lists[0] ?? null
  const filteredLists = activeProject?.lists.filter((list) => list.title.toLocaleLowerCase().includes(listSearch.trim().toLocaleLowerCase())) ?? []
  const completedCount = activeList?.items.filter((item) => item.completed).length ?? 0

  useEffect(() => { localStorage.setItem(storageKey, JSON.stringify(savedProjects)) }, [savedProjects])
  useEffect(() => { if (demoMode) localStorage.setItem('worklist-demo-projects-v1', JSON.stringify(demoProjects)) }, [demoProjects])

  useEffect(() => {
    const syncToken = () => {
      const nextToken = readToken()
      setToken(nextToken)
      setLoading(Boolean(nextToken))
      setProject(null)
      setActiveDemoId(null)
      setSelectedListId('')
    }
    window.addEventListener('hashchange', syncToken)
    return () => window.removeEventListener('hashchange', syncToken)
  }, [])

  useEffect(() => {
    if (!token || !supabase) return
    let active = true
    const loadProject = async () => {
      const { data, error: requestError } = await supabase.rpc('get_shared_project', { p_token: token })
      if (!active) return
      if (requestError) {
        setError(requestError.message)
        setProject(null)
      } else {
        const nextProject = data as Project
        setProject(nextProject)
        setError('')
        setSelectedListId((current) => nextProject.lists.some((list) => list.id === current) ? current : nextProject.lists[0]?.id ?? '')
        setSavedProjects((current) => current.some((saved) => saved.id === nextProject.id)
          ? current.map((saved) => saved.id === nextProject.id ? { ...saved, title: nextProject.title } : saved)
          : [{ id: nextProject.id, title: nextProject.title, token }, ...current])
      }
      setLoading(false)
    }
    void loadProject()
    const refresh = window.setInterval(() => void loadProject(), 12000)
    return () => { active = false; window.clearInterval(refresh) }
  }, [token])

  function updateDemoProject(projectId: string, update: (current: Project) => Project) {
    setDemoProjects((current) => current.map((entry) => entry.id === projectId ? update(entry) : entry))
  }

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = newProjectName.trim()
    if (!title) return
    setBusy(true)
    if (demoMode && !supabase) {
      const created: Project = { id: crypto.randomUUID(), title, lists: [] }
      setDemoProjects((current) => [created, ...current])
      setActiveDemoId(created.id)
      setSelectedListId('')
      setNewProjectName('')
      setBusy(false)
      return
    }
    if (!supabase) return
    const { data, error: requestError } = await supabase.rpc('create_shared_project', { p_title: title })
    setBusy(false)
    if (requestError) { setError(requestError.message); return }
    const result = data as { id: string; title: string; token: string }
    setSavedProjects((current) => [{ id: result.id, title: result.title, token: result.token }, ...current])
    setNewProjectName('')
    window.location.hash = new URLSearchParams({ share: result.token }).toString()
  }

  function openDemoProject(projectId: string) {
    setActiveDemoId(projectId)
    setSelectedListId(demoProjects.find((entry) => entry.id === projectId)?.lists[0]?.id ?? '')
    setError('')
  }

  function backToProjects() {
    if (token) {
      window.history.pushState(null, '', window.location.pathname + window.location.search)
      setToken(null)
      setProject(null)
    }
    setActiveDemoId(null)
    setSelectedListId('')
    setEditingItemId(null)
    setEditingProject(false)
    setEditingListId(null)
  }

  function openSavedProject(saved: SavedProject) {
    window.location.hash = new URLSearchParams({ share: saved.token }).toString()
  }

  async function saveProjectName() {
    if (!activeProject || !projectNameDraft.trim()) return
    const title = projectNameDraft.trim()
    if (demoMode && !token) {
      updateDemoProject(activeProject.id, (current) => ({ ...current, title }))
      setEditingProject(false)
      return
    }
    if (!supabase || !token) return
    const { error: requestError } = await supabase.rpc('rename_shared_project', { p_token: token, p_title: title })
    if (requestError) { setError(requestError.message); return }
    setProject((current) => current ? { ...current, title } : current)
    setSavedProjects((current) => current.map((entry) => entry.id === activeProject.id ? { ...entry, title } : entry))
    setEditingProject(false)
  }

  async function deleteProject() {
    if (!activeProject || !window.confirm(`删除项目“${activeProject.title}”及其全部 lists 和事项？此操作无法撤销。`)) return
    if (demoMode && !token) {
      setDemoProjects((current) => current.filter((entry) => entry.id !== activeProject.id))
      setActiveDemoId(null)
      setSelectedListId('')
      return
    }
    if (!supabase || !token) return
    setBusy(true)
    const { error: requestError } = await supabase.rpc('delete_shared_project', { p_token: token })
    setBusy(false)
    if (requestError) { setError(requestError.message); return }
    setSavedProjects((current) => current.filter((entry) => entry.id !== activeProject.id))
    backToProjects()
  }

  async function addList(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = newListName.trim()
    if (!activeProject || !title) return
    if (demoMode && !token) {
      const created: TaskList = { id: crypto.randomUUID(), title, items: [] }
      updateDemoProject(activeProject.id, (current) => ({ ...current, lists: [...current.lists, created] }))
      setSelectedListId(created.id)
      setNewListName('')
      return
    }
    if (!supabase || !token) return
    const { data, error: requestError } = await supabase.rpc('add_shared_list', { p_token: token, p_title: title })
    if (requestError) { setError(requestError.message); return }
    const created = data as TaskList
    setProject((current) => current ? { ...current, lists: [...current.lists, created] } : current)
    setSelectedListId(created.id)
    setNewListName('')
  }

  async function saveListName(list: TaskList) {
    const title = listNameDraft.trim()
    if (!title) { setError('List 名称不能为空'); return }
    if (demoMode && !token && activeProject) {
      updateDemoProject(activeProject.id, (current) => ({ ...current, lists: current.lists.map((entry) => entry.id === list.id ? { ...entry, title } : entry) }))
      setEditingListId(null)
      return
    }
    if (!supabase || !token) return
    const { error: requestError } = await supabase.rpc('rename_shared_list', { p_token: token, p_list_id: list.id, p_title: title })
    if (requestError) { setError(requestError.message); return }
    setProject((current) => current ? { ...current, lists: current.lists.map((entry) => entry.id === list.id ? { ...entry, title } : entry) } : current)
    setEditingListId(null)
  }

  async function deleteList(list: TaskList) {
    if (!activeProject || !window.confirm(`删除 list“${list.title}”及其中所有事项？`)) return
    if (demoMode && !token) {
      const nextLists = activeProject.lists.filter((entry) => entry.id !== list.id)
      updateDemoProject(activeProject.id, (current) => ({ ...current, lists: nextLists }))
      if (selectedListId === list.id) setSelectedListId(nextLists[0]?.id ?? '')
      return
    }
    if (!supabase || !token) return
    const { error: requestError } = await supabase.rpc('delete_shared_list', { p_token: token, p_list_id: list.id })
    if (requestError) { setError(requestError.message); return }
    const nextLists = activeProject.lists.filter((entry) => entry.id !== list.id)
    setProject((current) => current ? { ...current, lists: nextLists } : current)
    if (selectedListId === list.id) setSelectedListId(nextLists[0]?.id ?? '')
  }

  async function addItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = newItemName.trim()
    if (!activeProject || !activeList || !text) return
    if (demoMode && !token) {
      updateDemoProject(activeProject.id, (current) => ({ ...current, lists: current.lists.map((list) => list.id === activeList.id ? { ...list, items: [...list.items, { id: crypto.randomUUID(), text, note: '', completed: false }] } : list) }))
      setNewItemName('')
      return
    }
    if (!supabase || !token) return
    const { data, error: requestError } = await supabase.rpc('add_shared_item', { p_token: token, p_list_id: activeList.id, p_text: text })
    if (requestError) { setError(requestError.message); return }
    const item = data as Item
    setProject((current) => current ? { ...current, lists: current.lists.map((list) => list.id === activeList.id ? { ...list, items: [...list.items, item] } : list) } : current)
    setNewItemName('')
  }

  async function updateItem(item: Item, patch: Partial<Item>) {
    if (!activeProject || !activeList) return
    if (demoMode && !token) {
      updateDemoProject(activeProject.id, (current) => ({ ...current, lists: current.lists.map((list) => list.id === activeList.id ? { ...list, items: list.items.map((entry) => entry.id === item.id ? { ...entry, ...patch } : entry) } : list) }))
      return
    }
    if (!supabase || !token) return
    const { error: requestError } = await supabase.rpc('update_shared_item', { p_token: token, p_list_id: activeList.id, p_item_id: item.id, p_text: patch.text ?? null, p_note: patch.note ?? null, p_completed: patch.completed ?? null })
    if (requestError) { setError(requestError.message); return }
    setProject((current) => current ? { ...current, lists: current.lists.map((list) => list.id === activeList.id ? { ...list, items: list.items.map((entry) => entry.id === item.id ? { ...entry, ...patch } : entry) } : list) } : current)
    setError('')
  }

  async function deleteItem(item: Item) {
    if (!activeProject || !activeList) return
    if (demoMode && !token) {
      updateDemoProject(activeProject.id, (current) => ({ ...current, lists: current.lists.map((list) => list.id === activeList.id ? { ...list, items: list.items.filter((entry) => entry.id !== item.id) } : list) }))
      return
    }
    if (!supabase || !token) return
    const { error: requestError } = await supabase.rpc('delete_shared_item', { p_token: token, p_list_id: activeList.id, p_item_id: item.id })
    if (requestError) { setError(requestError.message); return }
    setProject((current) => current ? { ...current, lists: current.lists.map((list) => list.id === activeList.id ? { ...list, items: list.items.filter((entry) => entry.id !== item.id) } : list) } : current)
  }

  function setItemDraft(itemId: string, field: 'text' | 'note', value: string) {
    setItemDrafts((current) => ({ ...current, [itemId]: { ...current[itemId], [field]: value } }))
  }

  async function saveItem(item: Item) {
    const draft = itemDrafts[item.id] ?? {}
    const text = (draft.text ?? item.text).trim()
    const note = draft.note ?? item.note
    if (!text) { setError('事项名称不能为空'); return }
    await updateItem(item, { text, note })
    setEditingItemId(null)
    setItemDrafts((current) => { const next = { ...current }; delete next[item.id]; return next })
  }

  async function copyLink() {
    if (!token) return
    await navigator.clipboard.writeText(makeShareUrl(token))
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  async function rotateLink() {
    if (!supabase || !token || !window.confirm('旧项目分享链接将立即失效。确定继续吗？')) return
    const { data, error: requestError } = await supabase.rpc('rotate_shared_link', { p_token: token })
    if (requestError) { setError(requestError.message); return }
    const nextToken = (data as { token: string }).token
    setSavedProjects((current) => current.map((entry) => entry.id === activeProject?.id ? { ...entry, token: nextToken } : entry))
    window.location.hash = new URLSearchParams({ share: nextToken }).toString()
  }

  const projectCards = demoMode ? demoProjects : savedProjects

  return (
    <main className="app-shell project-app">
      <header className="topbar">
        <a className="brand" href={window.location.pathname} onClick={(event) => { event.preventDefault(); backToProjects() }} aria-label="Worklist 项目页">
          <span className="brand-mark"><Check size={17} strokeWidth={3} /></span><span>worklist<span className="brand-period">.</span></span>
        </a>
        <div className="topbar-note"><span className="live-dot" />{demoMode ? '本地交互预览' : '共享工作区'}</div>
      </header>

      {!supabase && !demoMode ? <section className="setup-state"><p className="eyebrow">需要配置</p><h1>连接清单数据库</h1><p>部署时请在 GitHub 仓库的 Actions Variables 中设置 Supabase URL 与 publishable key。</p></section>
        : loading ? <section className="loading-state"><LoaderCircle className="spin" /> 正在打开项目…</section>
          : activeProject ? <>
            <div className="project-toolbar">
              <button className="back-link" type="button" onClick={backToProjects}><ArrowLeft size={16} /> 所有项目</button>
              <div className="project-actions">
                {demoMode ? <span className="demo-tag">演示数据 · 不会同步</span> : <>
                  <button className="button button-primary" type="button" onClick={() => void copyLink()}>{copied ? <Check size={16} /> : <Link2 size={16} />}{copied ? '已复制项目链接' : '分享项目'}</button>
                  <button className="icon-button" type="button" title="更换分享链接" aria-label="更换分享链接" onClick={() => void rotateLink()}><RotateCw size={16} /></button>
                </>}
                <button className="icon-button danger-action" type="button" title="删除项目" aria-label="删除项目" onClick={() => void deleteProject()}><Trash2 size={16} /></button>
              </div>
            </div>
            <section className="project-heading">
              <p className="eyebrow">项目 <span className="heading-divider">/</span> {activeProject.lists.length} 个 lists</p>
              {editingProject ? <div className="title-edit-row"><input aria-label="项目名称" value={projectNameDraft} onChange={(event) => setProjectNameDraft(event.target.value)} maxLength={120} autoFocus /><button className="icon-button save-item-button" type="button" title="保存项目名称" onClick={() => void saveProjectName()}><Check size={17} /></button><button className="icon-button" type="button" title="取消" onClick={() => setEditingProject(false)}><X size={16} /></button></div>
                : <div className="title-display-row"><h1>{activeProject.title}</h1><button className="icon-button" type="button" title="修改项目名称" aria-label="修改项目名称" onClick={() => { setProjectNameDraft(activeProject.title); setEditingProject(true) }}><Pencil size={15} /></button></div>}
            </section>
            <div className="project-workspace">
              <aside className="lists-sidebar">
                <div className="sidebar-title"><span>LISTS</span><span>{activeProject.lists.length}</span></div>
                <div className="mobile-list-picker">
                  <button className={`mobile-list-trigger${mobileListMenuOpen ? ' is-open' : ''}`} type="button" aria-haspopup="listbox" aria-expanded={mobileListMenuOpen} onClick={() => { setMobileListMenuOpen((open) => !open); setListSearch('') }}>
                    <span><small>当前 List</small><strong>{activeList?.title ?? '选择一个 List'}</strong></span>
                    <ChevronDown size={18} />
                  </button>
                  {mobileListMenuOpen && <div className="mobile-list-menu">
                    <label className="mobile-list-search"><Search size={16} /><input aria-label="搜索 List 名称" placeholder="搜索 List…" value={listSearch} onChange={(event) => setListSearch(event.target.value)} autoFocus /><button type="button" aria-label="关闭 List 选择器" onClick={() => { setMobileListMenuOpen(false); setListSearch('') }}><X size={15} /></button></label>
                    <div className="mobile-list-options" role="listbox" aria-label="搜索结果">
                      {filteredLists.length ? filteredLists.map((list) => <div className={`mobile-list-option${activeList?.id === list.id ? ' selected' : ''}`} key={list.id}>
                        {editingListId === list.id ? <form className="list-rename-form" onSubmit={(event) => { event.preventDefault(); void saveListName(list) }}><input aria-label="List 名称" value={listNameDraft} onChange={(event) => setListNameDraft(event.target.value)} autoFocus /><button type="submit" title="保存名称" aria-label="保存 List 名称"><Check size={14} /></button><button type="button" title="取消" aria-label="取消修改 List 名称" onClick={() => setEditingListId(null)}><X size={14} /></button></form> : <>
                          <button className="mobile-list-option-select" type="button" role="option" aria-selected={activeList?.id === list.id} onClick={() => { setSelectedListId(list.id); setMobileListMenuOpen(false); setListSearch('') }}><span>{list.title}</span><small>{list.items.length}</small></button>
                          <div className="mobile-list-option-actions"><button type="button" title="修改 List 名称" aria-label={`修改 List 名称：${list.title}`} onClick={() => { setListNameDraft(list.title); setEditingListId(list.id) }}><Pencil size={13} /></button><button type="button" title="删除 List" aria-label={`删除 List：${list.title}`} onClick={() => void deleteList(list)}><Trash2 size={13} /></button></div>
                        </>}
                      </div>) : <div className="mobile-list-no-results">没有找到匹配的 List</div>}
                    </div>
                  </div>}
                </div>
                <nav className="list-nav" aria-label="项目 Lists">
                  {activeProject.lists.map((list) => <div className={`list-nav-row${activeList?.id === list.id ? ' selected' : ''}`} key={list.id}>
                    {editingListId === list.id ? <form className="list-rename-form" onSubmit={(event) => { event.preventDefault(); void saveListName(list) }}><input aria-label="List 名称" value={listNameDraft} onChange={(event) => setListNameDraft(event.target.value)} autoFocus /><button type="submit" title="保存名称" aria-label="保存 List 名称"><Check size={14} /></button><button type="button" title="取消" aria-label="取消修改 List 名称" onClick={() => setEditingListId(null)}><X size={14} /></button></form>
                      : <><button className="list-select" type="button" onClick={() => setSelectedListId(list.id)}><span className="list-select-title">{list.title}</span><span className="list-select-count">{list.items.length}</span></button><div className="list-nav-actions"><button type="button" title="修改 List 名称" aria-label={`修改 List 名称：${list.title}`} onClick={() => { setListNameDraft(list.title); setEditingListId(list.id) }}><Pencil size={12} /></button><button type="button" title="删除 List" aria-label={`删除 List：${list.title}`} onClick={() => void deleteList(list)}><Trash2 size={12} /></button></div></>}
                  </div>)}
                </nav>
                <form className="add-list-form" onSubmit={(event) => void addList(event)}><input aria-label="新 List 名称" placeholder="新增 List…" value={newListName} onChange={(event) => setNewListName(event.target.value)} maxLength={120} /><button type="submit" aria-label="新增 List" title="新增 List" disabled={!newListName.trim()}><Plus size={16} /></button></form>
              </aside>
              <section className="task-area" aria-label="List 事项">
                {activeList ? <>
                  <div className="task-header"><div><p className="eyebrow">当前 List</p><h2>{activeList.title}</h2></div><span className="task-progress">{completedCount} / {activeList.items.length} 完成</span></div>
                  <div className="list-panel">
                    <div className="list-toolbar"><span>事项 <span className="count-badge">{activeList.items.length}</span></span><span className="toolbar-caption">{demoMode ? '本地预览' : '更改自动同步'}</span></div>
                    <div className="items-list">
                      {activeList.items.length === 0 ? <div className="empty-items">这个 List 还没有事项，添加第一项开始。</div> : activeList.items.map((item, index) => <article className={`list-item${item.completed ? ' is-complete' : ''}`} key={item.id}>
                        <label className="check-wrap" aria-label={item.completed ? '标记为未完成' : '标记为已完成'}><input type="checkbox" checked={item.completed} onChange={(event) => void updateItem(item, { completed: event.target.checked })} /><span className="custom-check"><Check size={13} strokeWidth={3} /></span></label>
                        <span className="item-index">{String(index + 1).padStart(2, '0')}</span>
                        <div className="item-fields">{editingItemId === item.id ? <><input className="item-title edit-input" aria-label="事项名称" value={itemDrafts[item.id]?.text ?? item.text} onChange={(event) => setItemDraft(item.id, 'text', event.target.value)} maxLength={240} autoFocus /><input className="item-note edit-input" aria-label="备注" placeholder="添加备注…" value={itemDrafts[item.id]?.note ?? item.note} onChange={(event) => setItemDraft(item.id, 'note', event.target.value)} maxLength={2000} /></> : <><span className="item-title-text">{item.text}</span><span className={`item-note${item.note ? '' : ' item-note-empty'}`}>{item.note || '添加备注'}</span></>}</div>
                        <div className="item-actions">{editingItemId === item.id ? <><button className="icon-button save-item-button" type="button" title="保存修改" aria-label={`保存修改：${item.text}`} onClick={() => void saveItem(item)}><Check size={17} /></button><button className="icon-button" type="button" title="取消修改" aria-label={`取消修改：${item.text}`} onClick={() => { setEditingItemId(null); setItemDrafts((current) => { const next = { ...current }; delete next[item.id]; return next }) }}><X size={16} /></button></> : <button className="icon-button" type="button" title="编辑事项名称和备注" aria-label={`编辑事项：${item.text}`} onClick={() => { setItemDrafts((current) => ({ ...current, [item.id]: { text: item.text, note: item.note } })); setEditingItemId(item.id) }}><Pencil size={15} /></button>}<button className="icon-button delete-button" type="button" title="删除事项" aria-label={`删除事项：${item.text}`} onClick={() => void deleteItem(item)}><Trash2 size={16} /></button></div>
                      </article>)}
                    </div>
                    <form className="add-item-form" onSubmit={(event) => void addItem(event)}><Plus size={18} /><input aria-label="新增事项" placeholder="添加一项新事项…" value={newItemName} onChange={(event) => setNewItemName(event.target.value)} maxLength={240} /><button className="add-button" type="submit" disabled={!newItemName.trim()}>添加事项</button></form>
                  </div>
                </> : <div className="empty-list-state"><div className="empty-list-icon"><Plus size={20} /></div><h2>为项目添加第一个 List</h2><p>例如：本周安排、物资准备或会议跟进。</p><form className="empty-create-list" onSubmit={(event) => void addList(event)}><input aria-label="第一个 List 名称" placeholder="输入 List 名称…" value={newListName} onChange={(event) => setNewListName(event.target.value)} maxLength={120} /><button className="button button-primary" type="submit" disabled={!newListName.trim()}><Plus size={16} />创建 List</button></form></div>}
              </section>
            </div>
            <footer className="list-footer"><span>{demoMode ? '演示项目只保存在此浏览器。' : '项目链接持有者可以管理此项目下的所有 Lists。'}</span><a href="https://github.com/Lee-LYQ/WorkList" target="_blank" rel="noreferrer">源码 <ExternalLink size={13} /></a></footer>
          </> : <>
            <section className="projects-heading"><div><p className="eyebrow">WORKLIST <span className="heading-divider">/</span> PROJECTS</p><h1>你的项目</h1><p>每个项目有自己的 Lists 和分享链接。</p></div></section>
            <form className="new-project-form" onSubmit={(event) => void createProject(event)}><input aria-label="项目名称" placeholder="输入新项目名称…" value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} maxLength={120} required /><button className="button button-primary" type="submit" disabled={busy || !newProjectName.trim()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}新建项目</button></form>
            {projectCards.length ? <div className="project-grid">{projectCards.map((entry) => {
              const isDemo = 'lists' in entry
              const listCount = isDemo ? entry.lists.length : undefined
              return <button className="project-card" type="button" key={entry.id} onClick={() => isDemo ? openDemoProject(entry.id) : openSavedProject(entry)}><span className="project-card-mark"><Check size={17} /></span><span className="project-card-copy"><strong>{entry.title}</strong><small>{isDemo ? `${listCount} 个 Lists` : '通过分享链接打开'}</small></span><span className="project-card-arrow">↗</span></button>
            })}</div> : <div className="projects-empty"><p>还没有项目。创建一个项目，然后为它添加不同的 Lists。</p></div>}
            <p className="projects-note"><Link2 size={14} /> 每个项目有独立分享链接；组员打开链接即可共同编辑。</p>
          </>}

      {error && <div className="error-toast" role="alert">{error}</div>}
      <footer className="site-footer"><span>WORKLIST <span>·</span> SIMPLE BY DESIGN</span><span><Clipboard size={13} /> {demoMode ? '本地交互预览' : '保存即同步'}</span></footer>
    </main>
  )
}
