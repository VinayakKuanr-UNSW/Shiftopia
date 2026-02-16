
import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { 
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/modules/core/ui/primitives/breadcrumb';

export function NavBreadcrumb() {
  const location = useLocation();
  const pathSegments = location.pathname.split('/').filter(Boolean);
  
  if (pathSegments.length === 0) {
    return null;
  }

  // Format segment names for display (makes them more readable)
  const formatSegmentName = (segment: string) => {
    return segment.charAt(0).toUpperCase() + segment.slice(1);
  };

  const breadcrumbItems = pathSegments.map((segment, index) => {
    const formattedSegment = formatSegmentName(segment);
    const url = `/${pathSegments.slice(0, index + 1).join('/')}`;
    const isLast = index === pathSegments.length - 1;

    return {
      name: formattedSegment,
      url,
      isLast
    };
  });

  return (
    <Breadcrumb>
      <BreadcrumbList>
        {pathSegments[0] !== 'dashboard' && (
          <>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link to="/dashboard">Dashboard</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
          </>
        )}
        
        {breadcrumbItems.map((item, index) => (
          <React.Fragment key={item.url}>
            <BreadcrumbItem>
              {item.isLast ? (
                <BreadcrumbPage>{item.name}</BreadcrumbPage>
              ) : (
                <BreadcrumbLink asChild>
                  <Link to={item.url}>{item.name}</Link>
                </BreadcrumbLink>
              )}
            </BreadcrumbItem>
            {!item.isLast && <BreadcrumbSeparator />}
          </React.Fragment>
        ))}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
