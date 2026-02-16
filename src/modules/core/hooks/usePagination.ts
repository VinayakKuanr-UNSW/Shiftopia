
import { useState, useMemo } from 'react';

export interface PaginationResult<T> {
  currentPage: number;
  totalPages: number;
  pageSize: number;
  paginatedItems: T[];
  setCurrentPage: (page: number) => void;
  setPageSize: (size: number) => void;
  goToNextPage: () => void;
  goToPreviousPage: () => void;
  goToFirstPage: () => void;
  goToLastPage: () => void;
}

export const usePagination = <T>(
  items: T[],
  initialPage = 1,
  initialPageSize = 5
): PaginationResult<T> => {
  const [currentPage, setCurrentPage] = useState(initialPage);
  const [pageSize, setPageSize] = useState(initialPageSize);

  const totalPages = useMemo(() => {
    return Math.max(1, Math.ceil(items.length / pageSize));
  }, [items.length, pageSize]);

  // Ensure current page is in valid range when total pages changes
  useMemo(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    } else if (currentPage < 1) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages]);

  const paginatedItems = useMemo(() => {
    const startIndex = (currentPage - 1) * pageSize;
    return items.slice(startIndex, startIndex + pageSize);
  }, [items, currentPage, pageSize]);

  const goToNextPage = () => {
    setCurrentPage(prev => Math.min(prev + 1, totalPages));
  };

  const goToPreviousPage = () => {
    setCurrentPage(prev => Math.max(prev - 1, 1));
  };

  const goToFirstPage = () => {
    setCurrentPage(1);
  };

  const goToLastPage = () => {
    setCurrentPage(totalPages);
  };

  return {
    currentPage,
    totalPages,
    pageSize,
    paginatedItems,
    setCurrentPage,
    setPageSize,
    goToNextPage,
    goToPreviousPage,
    goToFirstPage,
    goToLastPage
  };
};
