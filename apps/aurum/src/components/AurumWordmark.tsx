import React from 'react';

export const AurumWordmark: React.FC<{ className?: string }> = ({ className = '' }) => (
  <span className={`aurum-wordmark ${className}`.trim()}>aurum</span>
);
