import { render, screen, fireEvent } from '@testing-library/react';
import { ThemeProvider } from '@/components/ThemeProvider';
import Quiz from '@/components/Quiz';
import { evaluateQuiz } from '@/lib/api';

jest.mock('@/lib/api', () => ({
  evaluateQuiz: jest.fn(),
}));

const mockQuestions = [
  {
    question: 'What is the capital of France?',
    options: ['Paris', 'London', 'Berlin', 'Madrid'],
    correctIndex: 0,
    explanation: 'Paris is the capital of France.'
  },
  {
    question: 'Which planet is known as the Red Planet?',
    options: ['Earth', 'Mars', 'Jupiter', 'Venus'],
    correctIndex: 1,
    explanation: 'Mars is known as the Red Planet.'
  }
];

const renderQuiz = () => {
  return render(
    <ThemeProvider>
      <Quiz
        questions={mockQuestions}
        difficulty="intermediate"
        lessonTitle="Test Lesson"
      />
    </ThemeProvider>
  );
};

describe('Quiz Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders quiz questions', () => {
    renderQuiz();
    
    expect(screen.getByText('What is the capital of France?')).toBeInTheDocument();
    expect(screen.getByText('Which planet is known as the Red Planet?')).toBeInTheDocument();
  });

  it('renders answer options', () => {
    renderQuiz();
    
    expect(screen.getByText('Paris')).toBeInTheDocument();
    expect(screen.getByText('London')).toBeInTheDocument();
    expect(screen.getByText('Mars')).toBeInTheDocument();
    expect(screen.getByText('Jupiter')).toBeInTheDocument();
  });

  it('allows selecting an answer', () => {
    renderQuiz();

    const firstOption = screen.getByRole('button', { name: /Paris/ });
    fireEvent.click(firstOption);

    // The button is disabled after submission
    expect(firstOption).toBeDisabled();
  });

  it('shows correct/incorrect feedback after submission', () => {
    renderQuiz();
    
    const correctOption = screen.getByText('Paris');
    fireEvent.click(correctOption);
    
    expect(screen.getByText('✅ Correct!')).toBeInTheDocument();
  });

  it('calculates score correctly', () => {
    renderQuiz();
    
    fireEvent.click(screen.getByText('Paris'));
    fireEvent.click(screen.getByText('Mars'));
    
    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('does not offer the dead-end single-answer mode', () => {
    renderQuiz();

    expect(screen.queryByRole('button', { name: /Single mode/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Showing 1 of/i)).not.toBeInTheDocument();
  });

  it('always renders all questions so evaluation is reachable', () => {
    renderQuiz();

    fireEvent.click(screen.getByText('Paris'));
    fireEvent.click(screen.getByText('Mars'));

    expect(screen.getByText('2/2')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Get AI Evaluation/i })).toBeInTheDocument();
  });

  it('surfaces an evaluation error instead of failing silently', async () => {
    (evaluateQuiz as jest.Mock).mockRejectedValue(new Error('Runtime unreachable'));
    renderQuiz();

    fireEvent.click(screen.getByText('Paris'));
    fireEvent.click(screen.getByText('Mars'));
    fireEvent.click(screen.getByRole('button', { name: /Get AI Evaluation/i }));

    expect(await screen.findByText(/Runtime unreachable/i)).toBeInTheDocument();
    expect(screen.queryByText(/correct/)).not.toBeInTheDocument();
  });
});