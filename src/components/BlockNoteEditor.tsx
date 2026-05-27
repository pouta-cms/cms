import React, { useMemo } from 'react';
import { BlockNoteView } from '@blocknote/mantine';
import '@blocknote/mantine/style.css';
import { useCreateBlockNote } from '@blocknote/react';

interface BlockNoteEditorProps {
  initialContent?: string;
  onChange: (blocks: any[]) => void;
  repoOwner: string;
  repoName: string;
}

export default function BlockNoteEditor({ initialContent, onChange, repoOwner, repoName }: BlockNoteEditorProps) {
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

  // Initialize the BlockNote editor with a custom R2 uploader hook
  const editor = useCreateBlockNote({
    initialContent: initialBlocks,
    uploadFile: async (file: File) => {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('repo_owner', repoOwner);
      formData.append('repo_name', repoName);

      const response = await fetch('/api/images/upload', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        let errorMsg = 'Failed to upload image';
        try {
          const errData = await response.json();
          errorMsg = errData.error || errorMsg;
        } catch (_) {}
        throw new Error(errorMsg);
      }

      const data = await response.json();
      if (!data.success || !data.url) {
        throw new Error(data.error || 'Failed to parse upload URL');
      }

      return data.url; // Returns full custom domain URL of the stored file
    }
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
