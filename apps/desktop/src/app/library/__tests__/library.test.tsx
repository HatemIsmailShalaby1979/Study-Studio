import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import Library from '@/app/library/page';
import { deleteLesson, loadLibrary } from '@/lib/libraryStore';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

// The library moved from localStorage to IndexedDB (lib/libraryStore.ts), so
// this suite seeds the store rather than localStorage. Mocking the store keeps
// the test about the page's behaviour instead of about IndexedDB.
jest.mock('@/lib/libraryStore', () => ({
  loadLibrary: jest.fn(),
  saveLibrary: jest.fn(),
  deleteLesson: jest.fn(),
  upsertLesson: jest.fn(),
  getLesson: jest.fn(),
}));

const mockLoadLibrary = loadLibrary as jest.MockedFunction<typeof loadLibrary>;
const mockDeleteLesson = deleteLesson as jest.MockedFunction<typeof deleteLesson>;

const oneLesson = [
  {
    id: 'lesson-1',
    title: 'Test Lesson',
    type: 'lesson',
    createdAt: new Date().toISOString(),
    sections: [],
    glossary: [],
    quiz: [],
  },
];

describe('Library', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLoadLibrary.mockResolvedValue(oneLesson as never);
    mockDeleteLesson.mockResolvedValue(true);
    globalThis.confirm = jest.fn(() => true);
    // The page best-effort fetches featured content on mount; keep it inert.
    globalThis.fetch = jest.fn(() => Promise.reject(new Error('offline'))) as never;
  });

  it('asks for confirmation before deleting a lesson', async () => {
    render(<Library />);

    const deleteButton = await screen.findByTitle('Delete lesson');
    fireEvent.click(deleteButton);

    expect(globalThis.confirm).toHaveBeenCalledTimes(1);
    expect(globalThis.confirm).toHaveBeenCalledWith('Delete this lesson from your learning journey?');
  });

  it('deletes from the store once confirmed', async () => {
    render(<Library />);

    fireEvent.click(await screen.findByTitle('Delete lesson'));

    await waitFor(() => expect(mockDeleteLesson).toHaveBeenCalledWith('lesson-1'));
  });

  it('does not delete when the confirmation is declined', async () => {
    (globalThis.confirm as jest.Mock).mockReturnValue(false);
    render(<Library />);

    const deleteButton = await screen.findByTitle('Delete lesson');
    fireEvent.click(deleteButton);

    expect(mockDeleteLesson).not.toHaveBeenCalled();
  });

  it('renders the lessons returned by the store', async () => {
    render(<Library />);

    expect(await screen.findByText('Test Lesson')).toBeInTheDocument();
  });
});
