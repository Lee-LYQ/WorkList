import { useEffect, useState } from 'react'
import type { User } from '@supabase/supabase-js'
import {
  ArrowLeft, Check, ChevronDown, Clipboard, Copy, ExternalLink, Link2, LoaderCircle,
  LogOut, Mail, Pencil, Plus, Search, Share2, Trash2, X,
} from 'lucide-react'
import { createClient } from '@supabase/supabase-js'
import './App.css'

type Item = { id: string; text: string; note: string; completed: boolean }
type TaskList = { id: string; title: string; items: Item[] }
type Permission = 'read' | 'items' | 'lists' | 'owner'
type Project = { id: string; title: string; lists: TaskList[]; owner: boolean; access_level: Permission; can_claim: boolean }
type ProjectCard = { id: string; title: string; token?: string; owner: boolean; lists_count?: number }
type ItemDraft = Partial<Pick<Item, 'text' | 'note'>>
type ShareLink = { id: string; permission: Exclude<Permission, 'owner'>; label: string; created_at: string; revoked: boolean }
type Activity = { actor_name: string; action: string; list_id: string | null; item_id: string | null; details: Record<string, unknown>; created_at: string }
type Route = { token: string | null; projectId: string | null }

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
const supabase = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null
const demoMode = import.meta.env.DEV && !supabase
const projectStorageKey = 'worklist-share-projects-v2'
const legacyProjectStorageKey = 'worklist-projects-v1'
const nicknameStorageKey = 'worklist-collaborator-name'
const guestSessionKey = 'worklist-guest-session'

const demoSeed: Project[] = [
  { id: 'demo-library', title: 'Waverley Library', owner: true, access_level: 'owner', can_claim: false, lists: [
    { id: 'demo-events', title: '活动安排', items: [
      { id: 'demo-item-1', text: '确认本周活动安排', note: '和前台核对场地时间', completed: true },
      { id: 'demo-item-2', text: '整理读书会材料', note: '打印新版讨论提纲', completed: false },
    ] },
    { id: 'demo-supplies', title: '物资准备', items: [{ id: 'demo-item-3', text: '清点活动用品', note: '', completed: false }] },
  ] },
  { id: 'demo-bookclub', title: '社区读书会', owner: true, access_level: 'owner', can_claim: false, lists: [
    { id: 'demo-reading', title: '本月书单', items: [{ id: 'demo-item-4', text: '收集成员推荐书目', note: '周五前汇总', completed: false }] },
    { id: 'demo-hosting', title: '聚会准备', items: [] },
  ] },
]

function readRoute(): Route {
  const hash = new URLSearchParams(window.location.hash.slice(1))
  return { token: hash.get('share'), projectId: hash.get('project') }
}
function shareUrl(token: string) {
  const url = new URL(window.location.href)
  url.hash = new URLSearchParams({ share: token }).toString()
  return url.toString()
}
function getGuestSessionId() {
  let id = localStorage.getItem(guestSessionKey)
  if (!id) { id = crypto.randomUUID(); localStorage.setItem(guestSessionKey, id) }
  return id
}
function readSavedProjects(): ProjectCard[] {
  try {
    const current = JSON.parse(localStorage.getItem(projectStorageKey) ?? '[]') as ProjectCard[]
    const legacy = JSON.parse(localStorage.getItem(legacyProjectStorageKey) ?? '[]') as Array<{ id: string; title: string; token: string }>
    const migrated = legacy.map((entry) => ({ ...entry, owner: false }))
    return [...current, ...migrated.filter((entry) => !current.some((saved) => saved.id === entry.id))]
  } catch { return [] }
}
function permissionLabel(permission: Permission) {
  return ({ owner: '所有者', read: '只读', items: '事项协作', lists: 'Lists 管理' })[permission]
}
function activityLabel(action: string) {
  return ({
    list_created: '创建了 List', list_renamed: '重命名了 List', list_deleted: '删除了 List',
    item_created: '添加了事项', item_renamed: '修改了事项名称', item_note_changed: '修改了备注',
    item_completion_changed: '更新了完成状态', item_deleted: '删除了事项',
  } as Record<string, string>)[action] ?? '更新了项目'
}

export default function ProjectWorkspaceAuth() {
  const [route, setRoute] = useState<Route>(readRoute)
  const [user, setUser] = useState<User | null>(null)
  const [authReady, setAuthReady] = useState(!supabase)
  const [email, setEmail] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [project, setProject] = useState<Project | null>(null)
  const [ownedProjects, setOwnedProjects] = useState<ProjectCard[]>([])
  const [savedProjects, setSavedProjects] = useState<ProjectCard[]>(readSavedProjects)
  const [demoProjects, setDemoProjects] = useState<Project[]>(() => {
    if (!demoMode) return []
    try { return JSON.parse(localStorage.getItem('worklist-demo-projects-v1') ?? 'null') as Project[] | null ?? demoSeed } catch { return demoSeed }
  })
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
  const [nickname, setNickname] = useState(() => localStorage.getItem(nicknameStorageKey) ?? '')
  const [showNicknamePrompt, setShowNicknamePrompt] = useState(false)
  const [claimPromptOpen, setClaimPromptOpen] = useState(false)
  const [activity, setActivity] = useState<Activity[]>([])
  const [sharePanelOpen, setSharePanelOpen] = useState(false)
  const [sharePermission, setSharePermission] = useState<Exclude<Permission, 'owner'>>('items')
  const [shareLabel, setShareLabel] = useState('事项协作')
  const [shareLinks, setShareLinks] = useState<ShareLink[]>([])
  const [newShareUrl, setNewShareUrl] = useState('')
  const [loading, setLoading] = useState(Boolean(readRoute().token || readRoute().projectId))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const activeDemo = demoMode ? demoProjects.find((entry) => entry.id === activeDemoId) ?? null : null
  const activeProject = route.token || route.projectId ? project : activeDemo
  const activeList = activeProject?.lists.find((entry) => entry.id === selectedListId) ?? activeProject?.lists[0] ?? null
  const filteredLists = activeProject?.lists.filter((list) => list.title.toLocaleLowerCase().includes(listSearch.trim().toLocaleLowerCase())) ?? []
  const completedCount = activeList?.items.filter((item) => item.completed).length ?? 0
  const accessLevel = activeProject?.access_level ?? 'read'
  const canEditItems = demoMode || activeProject?.owner === true || accessLevel === 'items' || accessLevel === 'lists'
  const canManageLists = demoMode || activeProject?.owner === true || accessLevel === 'lists'
  const isOwner = demoMode || activeProject?.owner === true
  const isSharedGuest = Boolean(route.token && !activeProject?.owner)

  useEffect(() => {
    if (!supabase) return
    let mounted = true
    void supabase.auth.getSession().then(({ data }) => {
      if (mounted) {
        const nextUser = data.session?.user ?? null
        setUser(nextUser)
        if (!nextUser) setOwnedProjects([])
        setAuthReady(true)
        setLoading(Boolean(readRoute().token || (readRoute().projectId && nextUser)))
      }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const nextUser = session?.user ?? null
      setUser(nextUser)
      if (!nextUser) setOwnedProjects([])
      setAuthReady(true)
      setLoading(Boolean(readRoute().token || (readRoute().projectId && nextUser)))
    })
    return () => { mounted = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => { localStorage.setItem(projectStorageKey, JSON.stringify(savedProjects)) }, [savedProjects])
  useEffect(() => { if (demoMode) localStorage.setItem('worklist-demo-projects-v1', JSON.stringify(demoProjects)) }, [demoProjects])

  useEffect(() => {
    const syncRoute = () => {
      const next = readRoute()
      setRoute(next)
      setLoading(Boolean(next.token || (next.projectId && user)))
      setProject(null)
      setActiveDemoId(null)
      setSelectedListId('')
      setActivity([])
    }
    window.addEventListener('hashchange', syncRoute)
    return () => window.removeEventListener('hashchange', syncRoute)
  }, [user])

  useEffect(() => {
    if (!supabase || !authReady || !user) return
    let active = true
    void supabase.rpc('list_my_projects').then(({ data, error: requestError }) => {
      if (!active) return
      if (requestError) { setError(requestError.message); return }
      setOwnedProjects((data ?? []) as ProjectCard[])
    })
    return () => { active = false }
  }, [authReady, user])

  useEffect(() => {
    if (!supabase || (!route.token && !route.projectId)) return
    if (route.projectId && !user) return
    let active = true
    const loadProject = async () => {
      const { data, error: requestError } = await supabase.rpc('get_shared_project', {
        p_project_id: route.projectId,
        p_token: route.token,
      })
      if (!active) return
      if (requestError) {
        setError(requestError.message)
        setProject(null)
      } else {
        const nextProject = data as Project
        setProject(nextProject)
        setError('')
        setSelectedListId((current) => nextProject.lists.some((list) => list.id === current) ? current : nextProject.lists[0]?.id ?? '')
        if (route.token) setSavedProjects((current) => current.some((saved) => saved.id === nextProject.id)
          ? current.map((saved) => saved.id === nextProject.id ? { ...saved, title: nextProject.title, token: route.token ?? undefined } : saved)
          : [{ id: nextProject.id, title: nextProject.title, token: route.token ?? undefined, owner: nextProject.owner }, ...current])
      }
      setLoading(false)
    }
    const loadActivity = async () => {
      const { data } = await supabase.rpc('get_project_activity', { p_project_id: route.projectId, p_token: route.token })
      if (active && data) setActivity(data as Activity[])
    }
    void loadProject()
    void loadActivity()
    const refresh = window.setInterval(() => { void loadProject(); void loadActivity() }, 20000)
    return () => { active = false; window.clearInterval(refresh) }
  }, [route.token, route.projectId, user])

  useEffect(() => {
    if (!sharePanelOpen || !supabase || !activeProject?.owner) return
    void supabase.rpc('list_project_shares', { p_project_id: activeProject.id }).then(({ data, error: requestError }) => {
      if (requestError) setError(requestError.message)
      else setShareLinks((data ?? []) as ShareLink[])
    })
  }, [sharePanelOpen, activeProject?.id, activeProject?.owner])

  function updateDemoProject(projectId: string, update: (current: Project) => Project) {
    setDemoProjects((current) => current.map((entry) => entry.id === projectId ? update(entry) : entry))
  }

  function navigate(hash: string) {
    window.location.hash = hash
    setRoute(readRoute())
    setLoading(true)
  }

  function backToProjects() {
    window.history.pushState(null, '', window.location.pathname + window.location.search)
    setRoute({ token: null, projectId: null })
    setProject(null)
    setActiveDemoId(null)
    setSelectedListId('')
    setEditingItemId(null)
    setEditingProject(false)
    setEditingListId(null)
    setSharePanelOpen(false)
  }

  async function sendSignInLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !email.trim()) return
    setBusy(true)
    setAuthMessage('')
    const { error: requestError } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` },
    })
    setBusy(false)
    if (requestError) setError(requestError.message)
    else setAuthMessage('登录链接已发送，请查看邮箱并点击链接完成登录。')
  }

  async function signOut() {
    if (!supabase) return
    await supabase.auth.signOut()
    backToProjects()
  }

  async function createProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = newProjectName.trim()
    if (!title) return
    if (demoMode) {
      const created: Project = { id: crypto.randomUUID(), title, owner: true, access_level: 'owner', can_claim: false, lists: [] }
      setDemoProjects((current) => [created, ...current])
      setActiveDemoId(created.id)
      setSelectedListId('')
      setNewProjectName('')
      return
    }
    if (!supabase || !user) { setError('请先登录，再创建项目。'); return }
    setBusy(true)
    const { data, error: requestError } = await supabase.rpc('create_shared_project', { p_title: title })
    setBusy(false)
    if (requestError) { setError(requestError.message); return }
    const result = data as { id: string; title: string }
    setOwnedProjects((current) => [{ id: result.id, title: result.title, owner: true, lists_count: 0 }, ...current])
    setNewProjectName('')
    navigate(new URLSearchParams({ project: result.id }).toString())
  }

  async function claimLegacyProject() {
    if (!supabase || !user || !route.token) return
    setBusy(true)
    const { data, error: requestError } = await supabase.rpc('claim_legacy_project', { p_token: route.token })
    setBusy(false)
    if (requestError) { setError(requestError.message); return }
    const result = data as { id: string }
    setOwnedProjects((current) => current.some((entry) => entry.id === result.id)
      ? current
      : [{ id: result.id, title: activeProject?.title ?? '已认领项目', owner: true, lists_count: activeProject?.lists.length ?? 0 }, ...current])
    setSavedProjects((current) => current.filter((entry) => entry.id !== result.id))
    navigate(new URLSearchParams({ project: result.id }).toString())
  }

  function openProjectCard(card: ProjectCard) {
    if (demoMode) { setActiveDemoId(card.id); setSelectedListId(demoProjects.find((entry) => entry.id === card.id)?.lists[0]?.id ?? ''); return }
    if (card.owner) navigate(new URLSearchParams({ project: card.id }).toString())
    else if (card.token) navigate(new URLSearchParams({ share: card.token }).toString())
  }

  async function saveProjectName() {
    if (!activeProject || !projectNameDraft.trim()) return
    const title = projectNameDraft.trim()
    if (demoMode && activeDemo) { updateDemoProject(activeProject.id, (current) => ({ ...current, title })); setEditingProject(false); return }
    if (!supabase || !activeProject.owner) return
    const { error: requestError } = await supabase.rpc('rename_shared_project', { p_project_id: activeProject.id, p_token: route.token, p_title: title })
    if (requestError) { setError(requestError.message); return }
    setProject((current) => current ? { ...current, title } : current)
    setOwnedProjects((current) => current.map((entry) => entry.id === activeProject.id ? { ...entry, title } : entry))
    setSavedProjects((current) => current.map((entry) => entry.id === activeProject.id ? { ...entry, title } : entry))
    setEditingProject(false)
  }

  async function deleteProject() {
    if (!activeProject || !window.confirm(`删除项目“${activeProject.title}”及其全部 Lists 和事项？此操作无法撤销。`)) return
    if (demoMode && activeDemo) { setDemoProjects((current) => current.filter((entry) => entry.id !== activeProject.id)); backToProjects(); return }
    if (!supabase || !activeProject.owner) return
    setBusy(true)
    const { error: requestError } = await supabase.rpc('delete_owned_project', { p_project_id: activeProject.id })
    setBusy(false)
    if (requestError) { setError(requestError.message); return }
    setOwnedProjects((current) => current.filter((entry) => entry.id !== activeProject.id))
    backToProjects()
  }

  async function deleteProjectCard(card: ProjectCard) {
    if (!card.owner || !window.confirm(`删除项目“${card.title}”及其全部 Lists 和事项？此操作无法撤销。`)) return
    if (demoMode) {
      setDemoProjects((current) => current.filter((entry) => entry.id !== card.id))
      return
    }
    if (!supabase || !user) return
    setBusy(true)
    setError('')
    const { error: requestError } = await supabase.rpc('delete_owned_project', { p_project_id: card.id })
    setBusy(false)
    if (requestError) { setError(requestError.message); return }
    setOwnedProjects((current) => current.filter((entry) => entry.id !== card.id))
    setSavedProjects((current) => current.filter((entry) => entry.id !== card.id))
  }

  async function createShareLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!supabase || !activeProject?.owner) return
    setBusy(true)
    const { data, error: requestError } = await supabase.rpc('create_project_share', { p_project_id: activeProject.id, p_permission: sharePermission, p_label: shareLabel })
    setBusy(false)
    if (requestError) { setError(requestError.message); return }
    const result = data as { token: string; id: string; permission: Exclude<Permission, 'owner'>; label: string }
    setNewShareUrl(shareUrl(result.token))
    setShareLinks((current) => [{ id: result.id, permission: result.permission, label: result.label, created_at: new Date().toISOString(), revoked: false }, ...current])
  }

  async function revokeShare(link: ShareLink) {
    if (!supabase || !activeProject?.owner || !window.confirm(`撤销“${link.label}”链接？该链接将立即失效。`)) return
    const { error: requestError } = await supabase.rpc('revoke_project_share', { p_project_id: activeProject.id, p_link_id: link.id })
    if (requestError) { setError(requestError.message); return }
    setShareLinks((current) => current.map((entry) => entry.id === link.id ? { ...entry, revoked: true } : entry))
  }

  function saveNickname(value: string) {
    const name = value.trim().slice(0, 60)
    setNickname(name)
    localStorage.setItem(nicknameStorageKey, name)
    setShowNicknamePrompt(false)
  }

  function actorFields() {
    if (activeProject?.owner && user) return { p_actor_name: user.email?.split('@')[0] || 'Owner', p_actor_session_id: null }
    const actorName = nickname.trim()
    if (!actorName) { setShowNicknamePrompt(true); setError('请先填写你在协作记录中显示的名称。'); return null }
    return { p_actor_name: actorName, p_actor_session_id: getGuestSessionId() }
  }

  function projectArgs() { return { p_project_id: activeProject?.id ?? null, p_token: route.token } }

  async function addList(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = newListName.trim()
    if (!activeProject || !title || !canManageLists) return
    if (demoMode && activeDemo) {
      const created: TaskList = { id: crypto.randomUUID(), title, items: [] }
      updateDemoProject(activeProject.id, (current) => ({ ...current, lists: [...current.lists, created] }))
      setSelectedListId(created.id); setNewListName(''); return
    }
    const actor = actorFields()
    if (!supabase || !actor) return
    const { data, error: requestError } = await supabase.rpc('add_shared_list', { ...projectArgs(), p_title: title, ...actor })
    if (requestError) { setError(requestError.message); return }
    const created = data as TaskList
    setProject((current) => current ? { ...current, lists: [...current.lists, created] } : current)
    setSelectedListId(created.id); setNewListName(''); void refreshActivity()
  }

  async function saveListName(list: TaskList) {
    const title = listNameDraft.trim()
    if (!title || !canManageLists) { setError('List 名称不能为空'); return }
    if (demoMode && activeDemo) {
      updateDemoProject(activeProject!.id, (current) => ({ ...current, lists: current.lists.map((entry) => entry.id === list.id ? { ...entry, title } : entry) }))
      setEditingListId(null); return
    }
    const actor = actorFields()
    if (!supabase || !actor) return
    const { error: requestError } = await supabase.rpc('rename_shared_list', { ...projectArgs(), p_list_id: list.id, p_title: title, ...actor })
    if (requestError) { setError(requestError.message); return }
    setProject((current) => current ? { ...current, lists: current.lists.map((entry) => entry.id === list.id ? { ...entry, title } : entry) } : current)
    setEditingListId(null); void refreshActivity()
  }

  async function deleteList(list: TaskList) {
    if (!activeProject || !canManageLists || !window.confirm(`删除 List“${list.title}”及其中所有事项？`)) return
    if (demoMode && activeDemo) {
      const nextLists = activeProject.lists.filter((entry) => entry.id !== list.id)
      updateDemoProject(activeProject.id, (current) => ({ ...current, lists: nextLists }))
      if (selectedListId === list.id) setSelectedListId(nextLists[0]?.id ?? '')
      return
    }
    const actor = actorFields()
    if (!supabase || !actor) return
    const { error: requestError } = await supabase.rpc('delete_shared_list', { ...projectArgs(), p_list_id: list.id, ...actor })
    if (requestError) { setError(requestError.message); return }
    const nextLists = activeProject.lists.filter((entry) => entry.id !== list.id)
    setProject((current) => current ? { ...current, lists: nextLists } : current)
    if (selectedListId === list.id) setSelectedListId(nextLists[0]?.id ?? '')
    void refreshActivity()
  }

  async function addItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const text = newItemName.trim()
    if (!activeProject || !activeList || !text || !canEditItems) return
    if (demoMode && activeDemo) {
      updateDemoProject(activeProject.id, (current) => ({ ...current, lists: current.lists.map((list) => list.id === activeList.id ? { ...list, items: [...list.items, { id: crypto.randomUUID(), text, note: '', completed: false }] } : list) }))
      setNewItemName(''); return
    }
    const actor = actorFields()
    if (!supabase || !actor) return
    const { data, error: requestError } = await supabase.rpc('add_shared_item', { ...projectArgs(), p_list_id: activeList.id, p_text: text, ...actor })
    if (requestError) { setError(requestError.message); return }
    const item = data as Item
    setProject((current) => current ? { ...current, lists: current.lists.map((list) => list.id === activeList.id ? { ...list, items: [...list.items, item] } : list) } : current)
    setNewItemName(''); void refreshActivity()
  }

  function setItemDraft(itemId: string, field: 'text' | 'note', value: string) {
    setItemDrafts((current) => ({ ...current, [itemId]: { ...current[itemId], [field]: value } }))
  }

  async function updateItem(item: Item, patch: Partial<Item>): Promise<boolean> {
    if (!activeProject || !activeList || !canEditItems) return false
    if (demoMode && activeDemo) {
      updateDemoProject(activeProject.id, (current) => ({ ...current, lists: current.lists.map((list) => list.id === activeList.id ? { ...list, items: list.items.map((entry) => entry.id === item.id ? { ...entry, ...patch } : entry) } : list) }))
      return true
    }
    const actor = actorFields()
    if (!supabase || !actor) return false
    const { error: requestError } = await supabase.rpc('update_shared_item', { ...projectArgs(), p_list_id: activeList.id, p_item_id: item.id, p_text: patch.text ?? null, p_note: patch.note ?? null, p_completed: patch.completed ?? null, ...actor })
    if (requestError) { setError(requestError.message); return false }
    setProject((current) => current ? { ...current, lists: current.lists.map((list) => list.id === activeList.id ? { ...list, items: list.items.map((entry) => entry.id === item.id ? { ...entry, ...patch } : entry) } : list) } : current)
    setError(''); void refreshActivity()
    return true
  }

  async function saveItem(item: Item) {
    const draft = itemDrafts[item.id] ?? {}
    const text = (draft.text ?? item.text).trim()
    if (!text) { setError('事项名称不能为空'); return }
    const updated = await updateItem(item, { ...(accessLevel === 'items' ? {} : { text }), note: draft.note ?? item.note })
    if (!updated) return
    setEditingItemId(null)
    setItemDrafts((current) => { const next = { ...current }; delete next[item.id]; return next })
  }

  async function deleteItem(item: Item) {
    if (!activeProject || !activeList || !canEditItems) return
    if (!window.confirm(`删除事项“${item.text}”？`)) return
    if (demoMode && activeDemo) {
      updateDemoProject(activeProject.id, (current) => ({ ...current, lists: current.lists.map((list) => list.id === activeList.id ? { ...list, items: list.items.filter((entry) => entry.id !== item.id) } : list) }))
      return
    }
    const actor = actorFields()
    if (!supabase || !actor) return
    const { error: requestError } = await supabase.rpc('delete_shared_item', { ...projectArgs(), p_list_id: activeList.id, p_item_id: item.id, ...actor })
    if (requestError) { setError(requestError.message); return }
    setProject((current) => current ? { ...current, lists: current.lists.map((list) => list.id === activeList.id ? { ...list, items: list.items.filter((entry) => entry.id !== item.id) } : list) } : current)
    void refreshActivity()
  }

  async function refreshActivity() {
    if (!supabase || !activeProject) return
    const { data } = await supabase.rpc('get_project_activity', { p_project_id: activeProject.id, p_token: route.token })
    if (data) setActivity(data as Activity[])
  }

  async function copyText(value: string, message: string) {
    await navigator.clipboard.writeText(value)
    setAuthMessage(message)
    window.setTimeout(() => setAuthMessage(''), 1800)
  }

  const projectCards: ProjectCard[] = demoMode
    ? demoProjects.map((entry) => ({ id: entry.id, title: entry.title, owner: true, lists_count: entry.lists.length }))
    : [...ownedProjects, ...savedProjects.filter((saved) => !ownedProjects.some((owned) => owned.id === saved.id))]

  const renderAuthForm = (compact = false) => <form className={`auth-form${compact ? ' auth-form-compact' : ''}`} onSubmit={(event) => void sendSignInLink(event)}>
    <label htmlFor={compact ? 'share-email' : 'owner-email'}>创建者登录</label>
    <div className="auth-input-row"><Mail size={17} /><input id={compact ? 'share-email' : 'owner-email'} type="email" autoComplete="email" placeholder="你的邮箱地址" value={email} onChange={(event) => setEmail(event.target.value)} required /><button className="button button-primary" type="submit" disabled={busy || !email.trim()}>{busy ? <LoaderCircle className="spin" size={16} /> : null}发送登录链接</button></div>
    <small>无需设置密码，我们会发送一次性登录链接。</small>
  </form>

  return (
    <main className="app-shell project-app">
      <header className="topbar">
        <a className="brand" href={window.location.pathname} onClick={(event) => { event.preventDefault(); backToProjects() }} aria-label="Worklist 项目页">
          <span className="brand-mark"><Check size={17} strokeWidth={3} /></span>
          <span>worklist<span className="brand-period">.</span></span>
        </a>
        <div className="topbar-account">
          <div className="topbar-note"><span className="live-dot" />{demoMode ? '本地交互预览' : '共享工作区'}</div>
          {user && <><span className="account-email">{user.email}</span><button className="icon-button signout-button" type="button" title="退出登录" aria-label="退出登录" onClick={() => void signOut()}><LogOut size={15} /></button></>}
        </div>
      </header>

      {!supabase && !demoMode ? (
        <section className="setup-state"><p className="eyebrow">需要配置</p><h1>连接清单数据库</h1><p>部署时请在 GitHub 仓库的 Actions Variables 中设置 Supabase URL 与 publishable key。</p></section>
      ) : !authReady || loading ? (
        <section className="loading-state"><LoaderCircle className="spin" /> 正在加载工作区…</section>
      ) : activeProject ? (
        <>
          <div className="project-toolbar">
            <button className="back-link" type="button" onClick={backToProjects}><ArrowLeft size={16} /> 所有项目</button>
            <div className="project-actions">
              {!demoMode && activeProject.owner && <button className="button button-primary" type="button" onClick={() => { setSharePanelOpen(true); setNewShareUrl('') }}><Share2 size={16} />分享权限</button>}
              {route.token && <button className="button button-primary" type="button" onClick={() => void copyText(shareUrl(route.token!), '分享链接已复制')}><Link2 size={16} />复制当前链接</button>}
              {activeProject.owner && <button className="button button-danger" type="button" onClick={() => void deleteProject()} disabled={busy}><Trash2 size={15} />删除项目</button>}
            </div>
          </div>

          <section className="project-heading">
            <p className="eyebrow">项目 <span className="heading-divider">/</span> {activeProject.lists.length} 个 lists <span className="heading-divider">/</span> {permissionLabel(accessLevel)}</p>
            {editingProject && activeProject.owner ? (
              <div className="title-edit-row"><input aria-label="项目名称" value={projectNameDraft} onChange={(event) => setProjectNameDraft(event.target.value)} maxLength={120} autoFocus /><button className="icon-button save-item-button" type="button" title="保存项目名称" onClick={() => void saveProjectName()}><Check size={17} /></button><button className="icon-button" type="button" title="取消" onClick={() => setEditingProject(false)}><X size={16} /></button></div>
            ) : (
              <div className="title-display-row"><h1>{activeProject.title}</h1>{activeProject.owner && <button className="icon-button" type="button" title="修改项目名称" aria-label="修改项目名称" onClick={() => { setProjectNameDraft(activeProject.title); setEditingProject(true) }}><Pencil size={15} /></button>}</div>
            )}
          </section>

          {isSharedGuest && <section className="guest-identity"><div><strong>协作显示名称</strong><small>此名称会显示在项目活动记录中；它是临时署名，不验证真实身份。</small></div><div className="guest-name-controls"><input aria-label="协作显示名称" placeholder="例如：Alex" maxLength={60} value={nickname} onChange={(event) => saveNickname(event.target.value)} />{activeProject.can_claim && <button className="text-button" type="button" onClick={() => user ? void claimLegacyProject() : setClaimPromptOpen(true)}>{user ? '认领旧项目' : '登录后认领此旧项目'}</button>}</div></section>}
          {showNicknamePrompt && isSharedGuest && <div className="nickname-prompt"><label htmlFor="collaborator-nickname">先设置活动记录中的显示名称</label><div><input id="collaborator-nickname" value={nickname} onChange={(event) => setNickname(event.target.value)} maxLength={60} placeholder="例如：Alex" autoFocus /><button className="button button-primary" type="button" disabled={!nickname.trim()} onClick={() => saveNickname(nickname)}>继续协作</button><button className="text-button" type="button" onClick={() => setShowNicknamePrompt(false)}>取消</button></div></div>}
          {claimPromptOpen && activeProject.can_claim && !user && <div className="auth-inline-panel"><p>登录后可将这个旧项目绑定到你的账号，之后能在首页找回并管理它。</p>{renderAuthForm(true)}<button className="text-button" type="button" onClick={() => setClaimPromptOpen(false)}>关闭</button></div>}
          {authMessage && <p className="inline-success" role="status">{authMessage}</p>}

          <div className="project-workspace">
            <aside className="lists-sidebar">
              <div className="sidebar-title"><span>LISTS</span><span>{activeProject.lists.length}</span></div>
              <div className="mobile-list-picker">
                <button className={`mobile-list-trigger${mobileListMenuOpen ? ' is-open' : ''}`} type="button" aria-haspopup="listbox" aria-expanded={mobileListMenuOpen} onClick={() => { setMobileListMenuOpen((open) => !open); setListSearch('') }}><span><small>当前 List</small><strong>{activeList?.title ?? '选择一个 List'}</strong></span><ChevronDown size={18} /></button>
                {mobileListMenuOpen && <div className="mobile-list-menu"><label className="mobile-list-search"><Search size={16} /><input aria-label="搜索 List 名称" placeholder="搜索 List…" value={listSearch} onChange={(event) => setListSearch(event.target.value)} autoFocus /><button type="button" aria-label="关闭 List 选择器" onClick={() => { setMobileListMenuOpen(false); setListSearch('') }}><X size={15} /></button></label><div className="mobile-list-options" role="listbox" aria-label="搜索结果">
                  {filteredLists.length ? filteredLists.map((list) => <div className={`mobile-list-option${activeList?.id === list.id ? ' selected' : ''}`} key={list.id}>
                    {editingListId === list.id ? <form className="list-rename-form" onSubmit={(event) => { event.preventDefault(); void saveListName(list) }}><input aria-label="List 名称" value={listNameDraft} onChange={(event) => setListNameDraft(event.target.value)} autoFocus /><button type="submit" aria-label="保存 List 名称"><Check size={14} /></button><button type="button" aria-label="取消修改 List 名称" onClick={() => setEditingListId(null)}><X size={14} /></button></form> : <>
                      <button className="mobile-list-option-select" type="button" role="option" aria-selected={activeList?.id === list.id} onClick={() => { setSelectedListId(list.id); setMobileListMenuOpen(false); setListSearch('') }}><span>{list.title}</span><small>{list.items.length}</small></button>
                      {canManageLists && <div className="mobile-list-option-actions"><button type="button" title="修改 List 名称" aria-label={`修改 List 名称：${list.title}`} onClick={() => { setListNameDraft(list.title); setEditingListId(list.id) }}><Pencil size={13} /></button><button type="button" title="删除 List" aria-label={`删除 List：${list.title}`} onClick={() => void deleteList(list)}><Trash2 size={13} /></button></div>}
                    </>}
                  </div>) : <div className="mobile-list-no-results">没有找到匹配的 List</div>}
                </div></div>}
              </div>
              <nav className="list-nav" aria-label="项目 Lists">{activeProject.lists.map((list) => <div className={`list-nav-row${activeList?.id === list.id ? ' selected' : ''}`} key={list.id}>
                {editingListId === list.id ? <form className="list-rename-form" onSubmit={(event) => { event.preventDefault(); void saveListName(list) }}><input aria-label="List 名称" value={listNameDraft} onChange={(event) => setListNameDraft(event.target.value)} autoFocus /><button type="submit" aria-label="保存 List 名称"><Check size={14} /></button><button type="button" aria-label="取消修改 List 名称" onClick={() => setEditingListId(null)}><X size={14} /></button></form> : <><button className="list-select" type="button" onClick={() => setSelectedListId(list.id)}><span className="list-select-title">{list.title}</span><span className="list-select-count">{list.items.length}</span></button>{canManageLists && <div className="list-nav-actions"><button type="button" title="修改 List 名称" aria-label={`修改 List 名称：${list.title}`} onClick={() => { setListNameDraft(list.title); setEditingListId(list.id) }}><Pencil size={12} /></button><button type="button" title="删除 List" aria-label={`删除 List：${list.title}`} onClick={() => void deleteList(list)}><Trash2 size={12} /></button></div>}</>}
              </div>)}</nav>
              {canManageLists && <form className="add-list-form" onSubmit={(event) => void addList(event)}><input aria-label="新 List 名称" placeholder="新增 List…" value={newListName} onChange={(event) => setNewListName(event.target.value)} maxLength={120} /><button type="submit" aria-label="新增 List" title="新增 List" disabled={!newListName.trim()}><Plus size={16} /></button></form>}
            </aside>

            <section className="task-area" aria-label="List 事项">
              {activeList ? <>
                <div className="task-header"><div><p className="eyebrow">当前 List</p><h2>{activeList.title}</h2></div><span className="task-progress">{completedCount} / {activeList.items.length} 完成</span></div>
                <div className="list-panel">
                  <div className="list-toolbar"><span>事项 <span className="count-badge">{activeList.items.length}</span></span><span className="toolbar-caption">{demoMode ? '本地预览' : '更改自动同步'}</span></div>
                  <div className="items-list">
                    {activeList.items.length === 0 ? <div className="empty-items">这个 List 还没有事项。</div> : activeList.items.map((item, index) => <article className={`list-item${item.completed ? ' is-complete' : ''}`} key={item.id}>
                      <label className="check-wrap" aria-label={item.completed ? '标记为未完成' : '标记为已完成'}><input type="checkbox" checked={item.completed} disabled={!canEditItems} onChange={(event) => void updateItem(item, { completed: event.target.checked })} /><span className="custom-check"><Check size={13} strokeWidth={3} /></span></label>
                      <span className="item-index">{String(index + 1).padStart(2, '0')}</span>
                      <div className="item-fields">
                        {editingItemId === item.id ? <>
                          {accessLevel !== 'items' && <input className="item-title edit-input" aria-label="事项名称" value={itemDrafts[item.id]?.text ?? item.text} onChange={(event) => setItemDraft(item.id, 'text', event.target.value)} maxLength={240} autoFocus />}
                          <input className="item-note edit-input" aria-label="备注" placeholder="添加备注…" value={itemDrafts[item.id]?.note ?? item.note} onChange={(event) => setItemDraft(item.id, 'note', event.target.value)} maxLength={2000} autoFocus={accessLevel === 'items'} />
                        </> : <><span className="item-title-text">{item.text}</span><span className={`item-note${item.note ? '' : ' item-note-empty'}`}>{item.note || '备注'}</span></>}
                      </div>
                      {canEditItems && <div className="item-actions">
                        {editingItemId === item.id ? <><button className="icon-button save-item-button" type="button" title="保存修改" onClick={() => void saveItem(item)}><Check size={17} /></button><button className="icon-button" type="button" title="取消修改" onClick={() => { setEditingItemId(null); setItemDrafts((current) => { const next = { ...current }; delete next[item.id]; return next }) }}><X size={16} /></button></> : <button className="icon-button" type="button" title={accessLevel === 'items' ? '编辑备注' : '编辑事项名称和备注'} onClick={() => { setItemDrafts((current) => ({ ...current, [item.id]: { text: item.text, note: item.note } })); setEditingItemId(item.id) }}><Pencil size={15} /></button>}
                        {(isOwner || accessLevel === 'lists') && <button className="icon-button delete-button" type="button" title="删除事项" onClick={() => void deleteItem(item)}><Trash2 size={16} /></button>}
                      </div>}
                    </article>)}
                  </div>
                  {canManageLists && <form className="add-item-form" onSubmit={(event) => void addItem(event)}><Plus size={18} /><input aria-label="新增事项" placeholder="添加一项新事项…" value={newItemName} onChange={(event) => setNewItemName(event.target.value)} maxLength={240} /><button className="add-button" type="submit" disabled={!newItemName.trim()}>添加事项</button></form>}
                </div>
              </> : canManageLists ? <div className="empty-list-state"><div className="empty-list-icon"><Plus size={20} /></div><h2>为项目添加第一个 List</h2><p>例如：本周安排、物资准备或会议跟进。</p><form className="empty-create-list" onSubmit={(event) => void addList(event)}><input aria-label="第一个 List 名称" placeholder="输入 List 名称…" value={newListName} onChange={(event) => setNewListName(event.target.value)} maxLength={120} /><button className="button button-primary" type="submit" disabled={!newListName.trim()}><Plus size={16} />创建 List</button></form></div> : <div className="empty-items">此项目目前还没有 Lists。</div>}
            </section>
          </div>
          {activity.length > 0 && <section className="activity-panel"><h2>最近活动</h2><div className="activity-list">{activity.map((entry, index) => <div className="activity-row" key={`${entry.created_at}-${index}`}><span className="activity-dot" /><p><strong>{entry.actor_name}</strong> {activityLabel(entry.action)}{typeof entry.details.item_text === 'string' ? `「${entry.details.item_text}」` : ''}{typeof entry.details.text === 'string' ? `「${entry.details.text}」` : ''}{typeof entry.details.title === 'string' ? `「${entry.details.title}」` : ''}</p><time>{new Date(entry.created_at).toLocaleString()}</time></div>)}</div></section>}
          <footer className="list-footer"><span>{demoMode ? '演示项目只保存在此浏览器。' : isOwner ? '你是此项目的创建者。' : `当前链接权限：${permissionLabel(accessLevel)}。`}</span><a href="https://github.com/Lee-LYQ/WorkList" target="_blank" rel="noreferrer">源码 <ExternalLink size={13} /></a></footer>
        </>
      ) : <>
        <section className="projects-heading"><div><p className="eyebrow">WORKLIST <span className="heading-divider">/</span> PROJECTS</p><h1>{user ? '我的项目' : '项目工作区'}</h1><p>{user ? '登录后创建和管理属于你的项目。' : '创建者登录后创建项目；协作者无需登录，使用分享链接访问。'}</p></div></section>
        {!user && !demoMode && <section className="auth-card">{renderAuthForm()}<p className="auth-hint">登录链接有效期有限；打开邮件链接后即可创建项目。</p></section>}
        {(user || demoMode) && <form className="new-project-form" onSubmit={(event) => void createProject(event)}><input aria-label="项目名称" placeholder="输入新项目名称…" value={newProjectName} onChange={(event) => setNewProjectName(event.target.value)} maxLength={120} required /><button className="button button-primary" type="submit" disabled={busy || !newProjectName.trim()}>{busy ? <LoaderCircle className="spin" size={17} /> : <Plus size={17} />}新建项目</button></form>}
        {authMessage && <p className="inline-success" role="status">{authMessage}</p>}
        {projectCards.length > 0 && <div className="project-grid">{projectCards.map((card) => <article className="project-card" key={`${card.id}-${card.owner ? 'owner' : 'share'}`}>
          <button className="project-card-open" type="button" onClick={() => openProjectCard(card)}><span className="project-card-mark"><Check size={17} /></span><span className="project-card-copy"><strong>{card.title}</strong><small>{card.owner ? `${card.lists_count ?? 0} 个 Lists · 我的项目` : '通过协作链接访问'}</small></span><span className="project-card-arrow">↗</span></button>
          {card.owner && <button className="project-card-delete" type="button" aria-label={`删除项目：${card.title}`} title="删除项目" onClick={() => void deleteProjectCard(card)} disabled={busy}><Trash2 size={16} /></button>}
        </article>)}</div>}
        {projectCards.length === 0 && user && <div className="projects-empty"><p>还没有项目。创建第一个项目开始协作。</p></div>}
        {!user && savedProjects.length === 0 && <div className="projects-empty"><p>打开组员分享给你的项目链接，即可在此浏览器中找回。</p></div>}
        <p className="projects-note"><Link2 size={14} /> 只有创建者需要登录；协作者使用持有的权限链接即可访问。</p>
      </>}

      {sharePanelOpen && activeProject?.owner && <div className="modal-backdrop" role="presentation" onClick={(event) => { if (event.target === event.currentTarget) setSharePanelOpen(false) }}><section className="share-modal" role="dialog" aria-modal="true" aria-labelledby="share-title"><header><div><p className="eyebrow">PROJECT ACCESS</p><h2 id="share-title">分享权限</h2></div><button className="icon-button" type="button" aria-label="关闭分享权限" onClick={() => setSharePanelOpen(false)}><X size={17} /></button></header><form className="share-create-form" onSubmit={(event) => void createShareLink(event)}><label>链接名称<input value={shareLabel} onChange={(event) => setShareLabel(event.target.value)} maxLength={80} required /></label><label>允许的操作<select value={sharePermission} onChange={(event) => setSharePermission(event.target.value as Exclude<Permission, 'owner'>)}><option value="read">只读</option><option value="items">事项协作：只能勾选完成、编辑备注</option><option value="lists">Lists 管理：可管理 Lists 和所有事项</option></select></label><button className="button button-primary" type="submit" disabled={busy || !shareLabel.trim()}><Plus size={16} />生成分享链接</button></form>{newShareUrl && <div className="generated-link"><label>新链接只显示在这里，请现在复制保存<input readOnly value={newShareUrl} /></label><button className="button button-primary" type="button" onClick={() => void copyText(newShareUrl, '分享链接已复制')}><Copy size={15} />复制链接</button></div>}<div className="share-link-list"><h3>已创建的链接</h3>{shareLinks.length ? shareLinks.map((link) => <div className={`share-link-row${link.revoked ? ' revoked' : ''}`} key={link.id}><div><strong>{link.label}</strong><small>{permissionLabel(link.permission)} · {link.revoked ? '已撤销' : new Date(link.created_at).toLocaleDateString()}</small></div>{!link.revoked && <button className="text-button danger-text" type="button" onClick={() => void revokeShare(link)}>撤销</button>}</div>) : <p className="share-empty">还没有分享链接。</p>}</div></section></div>}
      {error && <div className="error-toast" role="alert">{error}</div>}
      <footer className="site-footer"><span>WORKLIST <span>·</span> SIMPLE BY DESIGN</span><span><Clipboard size={13} /> {demoMode ? '本地交互预览' : '保存即同步'}</span></footer>
    </main>
  )
}
