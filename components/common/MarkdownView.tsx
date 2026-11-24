import React from 'react';
import { renderSafeMarkdown } from '../../core/security/sanitize';

interface MarkdownViewProps {
  content: string;
  className?: string;
}

export const MarkdownView: React.FC<MarkdownViewProps> = React.memo(({ content, className = '' }) => {
  const html = React.useMemo(() => renderSafeMarkdown(content), [content]);
  return (
    <div
      className={`cc-prose text-[13px] leading-relaxed ${className}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
});

MarkdownView.displayName = 'MarkdownView';
