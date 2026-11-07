// All database access lives here, so swapping storage only touches this file.
import { sampleBoard } from './sampleBoard.js'
import { supabase } from './supabase.js'

function unwrap({ data, error }) {
  if (error) throw error
  return data
}

export async function signOut() {
  await supabase.auth.signOut()
}

// Players don't make email accounts: each phone gets an anonymous user that
// stays signed in, so refreshing keeps them on their team.
export async function ensurePlayerSession() {
  const { data } = await supabase.auth.getSession()
  if (data.session) return data.session
  return unwrap(await supabase.auth.signInAnonymously()).session
}

// ---------- Rooms ----------

export async function createRoom(boardId) {
  return unwrap(await supabase.rpc('create_room', { p_board_id: boardId }))
}

export async function listMyRooms(userId) {
  return unwrap(
    await supabase
      .from('rooms')
      .select('code, created_at')
      .eq('host_id', userId)
      .order('created_at', { ascending: false })
      .limit(5),
  )
}

// Returns null when the room doesn't exist or this user hasn't joined it.
export async function getRoomByCode(code) {
  return unwrap(
    await supabase.from('rooms').select('id').eq('code', code.toUpperCase()).maybeSingle(),
  )
}

export async function joinRoom(code, name) {
  return unwrap(await supabase.rpc('join_room', { p_code: code, p_name: name }))
}

export async function loadRoomState(roomId) {
  const room = unwrap(await supabase.from('rooms').select('*').eq('id', roomId).single())
  const [teams, players, buzzes, played] = await Promise.all([
    supabase.from('teams').select('*').eq('room_id', roomId).order('created_at'),
    supabase.from('players').select('*').eq('room_id', roomId).order('joined_at'),
    supabase
      .from('buzzes')
      .select('*')
      .eq('room_id', roomId)
      .eq('round', room.buzz_round)
      .order('id'),
    supabase.from('played_questions').select('question_id').eq('room_id', roomId),
  ])
  return {
    room,
    teams: unwrap(teams),
    players: unwrap(players),
    buzzes: unwrap(buzzes),
    played: new Set(unwrap(played).map((p) => p.question_id)),
  }
}

// Calls onChange whenever anything in the room changes, and after every
// (re)connect so a phone waking from sleep catches up.
export function subscribeRoom(roomId, onChange) {
  const channel = supabase.channel(`room-${roomId}`)
  for (const table of ['teams', 'players', 'buzzes', 'played_questions']) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table, filter: `room_id=eq.${roomId}` },
      onChange,
    )
  }
  channel.on(
    'postgres_changes',
    { event: '*', schema: 'public', table: 'rooms', filter: `id=eq.${roomId}` },
    onChange,
  )
  channel.subscribe((status) => {
    if (status === 'SUBSCRIBED') onChange()
  })
  return () => supabase.removeChannel(channel)
}

// ---------- Buzzer (host) ----------

// Opening starts a new round, which clears the last round's buzzes.
export async function openBuzzers(room) {
  unwrap(
    await supabase
      .from('rooms')
      .update({ buzz_open: true, buzz_round: room.buzz_round + 1 })
      .eq('id', room.id),
  )
}

export async function closeBuzzers(roomId) {
  unwrap(await supabase.from('rooms').update({ buzz_open: false }).eq('id', roomId))
}

// ---------- Teams ----------

export async function createTeam(roomId, name) {
  const { data, error } = await supabase
    .from('teams')
    .insert({ room_id: roomId, name: name.trim() })
    .select()
    .single()
  if (error?.code === '23505') throw new Error('That team name is taken.')
  if (error) throw error
  return data
}

export async function deleteTeam(teamId) {
  unwrap(await supabase.from('teams').delete().eq('id', teamId))
}

export async function setMyTeam(roomId, userId, teamId) {
  unwrap(
    await supabase
      .from('players')
      .update({ team_id: teamId })
      .eq('room_id', roomId)
      .eq('user_id', userId),
  )
}

// ---------- Buzzer (players) ----------

export async function buzz(roomId) {
  return unwrap(await supabase.rpc('buzz', { p_room_id: roomId }))
}

// Host's TV calls this when a team's answer time runs out; the team may then
// buzz again.
export async function expireBuzz(buzzId) {
  unwrap(await supabase.from('buzzes').update({ expired: true }).eq('id', buzzId))
}

// ---------- Boards ----------

// The host's most recent board, creating the sample one if they have none.
export async function ensureBoard() {
  const boards = unwrap(
    await supabase.from('boards').select('id').order('created_at', { ascending: false }).limit(1),
  )
  if (boards.length) return boards[0].id

  const board = unwrap(
    await supabase.from('boards').insert({ title: sampleBoard.title }).select('id').single(),
  )
  const categories = unwrap(
    await supabase
      .from('categories')
      .insert(sampleBoard.categories.map((c, i) => ({ board_id: board.id, position: i, name: c.name })))
      .select('id, position'),
  )
  const questions = categories.flatMap((category) =>
    sampleBoard.categories[category.position].questions.map(([prompt, answer], i) => ({
      category_id: category.id,
      value: (i + 1) * 100,
      prompt,
      answer,
    })),
  )
  unwrap(await supabase.from('questions').insert(questions))
  return board.id
}

// Categories in order, each with its questions sorted by value.
export async function loadBoard(boardId) {
  const categories = unwrap(
    await supabase
      .from('categories')
      .select('id, name, position, questions(id, value, prompt, answer, image_url)')
      .eq('board_id', boardId)
      .order('position'),
  )
  for (const category of categories) category.questions.sort((a, b) => a.value - b.value)
  return categories
}

// ---------- Playing questions (host) ----------

// Shows a question with the buzzers closed and the last question's buzzes cleared.
export async function showQuestion(room, questionId) {
  unwrap(
    await supabase
      .from('rooms')
      .update({
        phase: 'question',
        current_question_id: questionId,
        buzz_open: false,
        buzz_round: room.buzz_round + 1,
      })
      .eq('id', room.id),
  )
}

export async function judgeAnswer(buzzId, correct) {
  unwrap(await supabase.rpc('judge_answer', { p_buzz_id: buzzId, p_correct: correct }))
}

export async function revealAnswer(roomId) {
  unwrap(await supabase.rpc('finish_question', { p_room_id: roomId }))
}

export async function backToBoard(roomId) {
  unwrap(
    await supabase
      .from('rooms')
      .update({ phase: 'board', current_question_id: null, buzz_open: false })
      .eq('id', roomId),
  )
}

export async function reopenQuestion(roomId, questionId) {
  unwrap(
    await supabase
      .from('played_questions')
      .delete()
      .eq('room_id', roomId)
      .eq('question_id', questionId),
  )
}

export async function undoLastScore(roomId) {
  unwrap(await supabase.rpc('undo_last_score', { p_room_id: roomId }))
}

// Add (or with a negative number, take away) points for a team by hand.
export async function adjustScore(teamId, points) {
  unwrap(await supabase.rpc('adjust_score', { p_team_id: teamId, p_points: points }))
}
