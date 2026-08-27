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
    (window.localStorage.getItem as jest.Mock).mockImplementation((key: string) => {
      if (key === LIBRARY_KEY) return JSON.stringify(oneLesson);
      if (key === 'study-studio-progress') return '{}';
      return null;
    });
    window.confirm = jest.fn(() => true);
  });

  it('asks for confirmation before deleting a lesson', async () => {
    render(<Library />);

    const deleteButton = await screen.findByTitle('Delete lesson');
    fireEvent.click(deleteButton);

    expect(window.confirm).toHaveBeenCalledTimes(1);
    expect(window.confirm).toHaveBeenCalledWith('Delete this lesson from your learning journey?');
  });

  it('does not delete when the confirmation is declined', async () => {
    (window.confirm as jest.Mock).mockReturnValue(false);
    render(<Library />);

    const deleteButton = await screen.findByTitle('Delete lesson');
    fireEvent.click(deleteButton);

    expect(window.localStorage.setItem).not.toHaveBeenCalledWith(LIBRARY_KEY, '[]');
    expect(window.localStorage.removeItem).not.toHaveBeenCalledWith('study-studio-quiz-lesson-1');
  });
});
