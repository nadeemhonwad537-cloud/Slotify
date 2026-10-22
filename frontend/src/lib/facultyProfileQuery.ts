export async function fetchNullableFacultyProfile<T>(
  request: () => Promise<T | null | undefined>,
): Promise<T | null> {
  return (await request()) ?? null;
}
