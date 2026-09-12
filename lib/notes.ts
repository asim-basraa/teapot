import { createClient } from "@/lib/supabase/server";

export type NoteThread = {
  note_id: string;
  /** The sender's address for the inbox owner; "Post-it" for the sender. */
  who: string;
  anonymous: boolean;
  opened_at: string;
  last_message_at: string;
  messages: number;
  preview: string | null;
  unread: boolean;
};

export type NoteMessage = {
  message_id: string;
  body: string;
  created_at: string;
  from_owner: boolean;
  mine: boolean;
};

export type NoteResult =
  | { ok: true }
  | { ok: false; error: string; status: number };

/**
 * The conversations the caller is part of.
 *
 * One function for both sides: the inbox owner gets every thread, everybody
 * else gets the ones they started. The database decides which, so there is no
 * branch here that could disagree with the policy.
 */
export async function listNoteThreads(): Promise<NoteThread[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("note_threads");

  if (error) {
    console.error("note_threads failed: %s", error.message);
    return [];
  }
  return (data as NoteThread[] | null) ?? [];
}

/** Every message in one thread. Empty for anybody who is not in it. */
export async function readNote(noteId: string): Promise<NoteMessage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("note_conversation", {
    p_note_id: noteId,
  });

  if (error) {
    console.error("note_conversation failed: %s", error.message);
    return [];
  }
  return (data as NoteMessage[] | null) ?? [];
}

export async function replyToNote(
  noteId: string,
  message: string,
): Promise<NoteResult> {
  const trimmed = message.trim();
  if (!trimmed) return { ok: false, error: "Say something first.", status: 400 };
  if (trimmed.length > 2000) {
    return { ok: false, error: "Keep it under 2000 characters.", status: 400 };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("reply_to_note", {
    p_note_id: noteId,
    p_message: trimmed,
  });

  if (!error) return { ok: true };

  // The one refusal worth explaining rather than hiding. Everything else reads
  // as not-found, so a stranger cannot learn which note ids are real.
  if (/nobody to reply to/i.test(error.message)) {
    return {
      ok: false,
      error: "That note was sent anonymously, so there is nobody to reply to.",
      status: 400,
    };
  }

  return { ok: false, error: "Not found.", status: 404 };
}

export async function markNoteSeen(noteId: string): Promise<void> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("mark_note_seen", { p_note_id: noteId });
  if (error) console.error("mark_note_seen failed: %s", error.message);
}

/** How many conversations have something the caller has not read. */
export async function countUnreadNotes(): Promise<number> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("unread_note_count");
  if (error) {
    console.error("unread_note_count failed: %s", error.message);
    return 0;
  }
  return (data as number | null) ?? 0;
}

/** Whether the caller is the person notes are sent to. */
export async function isInboxOwner(): Promise<boolean> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("is_inbox_owner");
  if (error) {
    console.error("is_inbox_owner failed: %s", error.message);
    return false;
  }
  return data === true;
}

/**
 * Throws a conversation away, for both sides.
 *
 * Only the inbox owner may, which the database decides; anybody else gets the
 * same not-found a conversation that does not exist would give.
 */
export async function deleteNote(noteId: string): Promise<NoteResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("delete_note", {
    p_note_id: noteId,
  });

  if (error) return { ok: false, error: "Not found.", status: 404 };
  // False means there was nothing there, which is the same answer.
  if (data !== true) return { ok: false, error: "Not found.", status: 404 };
  return { ok: true };
}
