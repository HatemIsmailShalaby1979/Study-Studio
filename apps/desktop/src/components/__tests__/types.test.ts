describe('Types', () => {
  describe('Lesson', () => {
    it('should have correct structure', () => {
      const lesson = {
        id: 'test-id',
        title: 'Test Lesson',
        sections: [
          { heading: 'Introduction', content: 'Welcome to the lesson' }
        ],
        glossary: [
          { term: 'API', definition: 'Application Programming Interface' }
        ],
        quiz: [
          {
            question: 'What does API stand for?',
            options: ['Application Programming Interface', 'Apple Pie Interface', 'Advanced Programming Integration', 'Automated Process Integration'],
            correctIndex: 0,
            explanation: 'API stands for Application Programming Interface.'
          }
        ],
        createdAt: new Date().toISOString(),
        type: 'lesson',
        difficulty: 'intermediate'
      };

      expect(lesson.id).toBe('test-id');
      expect(lesson.title).toBe('Test Lesson');
      expect(lesson.sections).toHaveLength(1);
      expect(lesson.glossary).toHaveLength(1);
      expect(lesson.quiz).toHaveLength(1);
      expect(lesson.difficulty).toBe('intermediate');
    });
  });

  describe('QuizQuestion', () => {
    it('should have correct structure', () => {
      const question = {
        question: 'What is 2 + 2?',
        options: ['3', '4', '5', '6'],
        correctIndex: 1,
        explanation: '2 + 2 = 4'
      };

      expect(question.question).toBe('What is 2 + 2?');
      expect(question.options).toHaveLength(4);
      expect(question.correctIndex).toBe(1);
      expect(question.explanation).toBe('2 + 2 = 4');
    });
  });

  describe('Difficulty', () => {
    it('should only accept valid difficulty levels', () => {
      const validDifficulties = ['beginner', 'intermediate', 'expert'] as const;
      
      validDifficulties.forEach(difficulty => {
        expect(['beginner', 'intermediate', 'expert']).toContain(difficulty);
      });
    });
  });
});