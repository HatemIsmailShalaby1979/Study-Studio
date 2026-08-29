import { render, screen, fireEvent } from '@testing-library/react';
import Library from '@/app/library/page';

jest.mock('next/link', () => ({
  __esModule: true,
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const LIBRARY_KEY = 'study-studio-library';

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
    (globalThis.localStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === LIBRARY_KEY) return JSON.stringify(oneLesson);
      if (key === 'study-studio-progress') return '{}';
      return null;
    });
    globalThis.confirm = jest.fn(() => true);
  });

  it('asks for confirmation before deleting a lesson', async () => {
    render(<Library />);

    const deleteButton = await screen.findByTitle('Delete lesson');
    fireEvent.click(deleteButton);

    expect(globalThis.confirm).toHaveBeenCalledTimes(1);
    expect(globalThis.confirm).toHaveBeenCalledWith('Delete this lesson from your learning journey?');
  });

  it('does not delete when the confirmation is declined', async () => {
    (globalThis.confirm as jest.Mock).mockReturnValue(false);
    render(<Library />);

    const deleteButton = await screen.findByTitle('Delete lesson');
    fireEvent.click(deleteButton);

    expect(globalThis.localStorage.setItem).not.toHaveBeenCalledWith(LIBRARY_KEY, '[]');
    expect(globalThis.localStorage.removeItem).not.toHaveBeenCalledWith('study-studio-quiz-lesson-1');
  });
});
