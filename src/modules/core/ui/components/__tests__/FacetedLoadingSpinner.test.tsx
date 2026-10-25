import React from 'react';
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { FacetedLoadingSpinner } from '../FacetedLoadingSpinner';

describe('FacetedLoadingSpinner', () => {
  it('renders the spinning faceted loading ring', () => {
    render(<FacetedLoadingSpinner />);
    const img = screen.getByAltText('Loading...');
    expect(img).toBeInTheDocument();
    expect(img).toHaveClass('animate-spin');
  });

  it('renders the label when provided', () => {
    render(<FacetedLoadingSpinner label="Loading requests" />);
    expect(screen.getByText('Loading requests')).toBeInTheDocument();
  });
});
