/** A denied Clipboard API write must leave the whole task available for manual copying. */
export async function copyTaskText(text: string, fallback: HTMLTextAreaElement | null) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    fallback?.focus();
    fallback?.select();
    return false;
  }
}
