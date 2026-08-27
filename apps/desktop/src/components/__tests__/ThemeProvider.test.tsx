import { render, screen, act } from '@testing-library/react';
import { ThemeProvider } from '@/components/ThemeProvider';

describe('ThemeProvider', () => {
  it('provides theme context to children', () => {
    const TestComponent = () => {
      const { theme, toggle } = require('@/components/ThemeProvider').useTheme();
      return (
        <div>
          <span data-testid="theme">{theme}</span>
          <button onClick={toggle} data-testid="toggle">Toggle</button>
        </div>
      );
    };

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });

  it('toggles theme when button clicked', () => {
    const TestComponent = () => {
      const { theme, toggle } = require('@/components/ThemeProvider').useTheme();
      return (
        <div>
          <span data-testid="theme">{theme}</span>
          <button onClick={toggle} data-testid="toggle">Toggle</button>
        </div>
      );
    };

    render(
      <ThemeProvider>
        <TestComponent />
      </ThemeProvider>
    );

    const toggleButton = screen.getByTestId('toggle');
    
    act(() => {
      toggleButton.click();
    });

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });
});