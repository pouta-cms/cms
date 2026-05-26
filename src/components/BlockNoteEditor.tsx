import React, { useMemo } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { useCreateBlockNote } from '@blocknote/react';

interface BlockNoteEditorProps {
  initialContent?: string;
  onChange: (blocks: any[]) => void;
}

export default function BlockNoteEditor({ initialContent, onChange }: BlockNoteEditorProps) {
  // Safe initial content parsing
  const initialBlocks = useMemo(() => {
    if (!initialContent) return undefined;
    try {
      const parsed = JSON.parse(initialContent);
      return Array.isArray(parsed) && parsed.length > 0 ? parsed : undefined;
    } catch (e) {
      console.error('Failed to parse initialContent in BlockNoteEditor:', e);
      return undefined;
    }
  }, [initialContent]);

  // Initialize the BlockNote editor
  const editor = useCreateBlockNote({
    initialContent: initialBlocks,
  });

  return (
    <div className="w-full h-full min-h-[500px] text-left">
      <BlockNoteView
        editor={editor}
        onChange={() => {
          // Trigger the onChange callback with the latest block documents
          onChange(editor.document);
        }}
        theme="dark"
      />
    </div>
  );
}
