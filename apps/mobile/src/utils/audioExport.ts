// Save generated Study Studio content into the app's document directory and
// share/export it to another app (Files, WhatsApp, email, ...) via the native
// share sheet. This is the mobile equivalent of the desktop "Download".
import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

export interface ExportableLesson {
  title: string;
  inputText?: string;
  sections: { heading: string; content: string }[];
  glossary?: { term: string; definition: string }[];
}

function sanitizeFileName(name: string): string {
  return (name || 'study-studio')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function buildTranscriptMarkdown(lesson: ExportableLesson): string {
  const lines: string[] = [];
  lines.push(`# ${lesson.title}`, '');
  if (lesson.inputText) {
    lines.push(`**Topic:** ${lesson.inputText}`, '');
  }
  lines.push('---', '');
  lesson.sections.forEach((section) => {
    lines.push(`## ${section.heading}`, '', section.content, '');
  });
  if (lesson.glossary && lesson.glossary.length > 0) {
    lines.push('---', '', '## Glossary', '');
    lesson.glossary.forEach((term) => {
      lines.push(`- **${term.term}**: ${term.definition}`);
    });
  }
  return lines.join('\n');
}

/** Write the lesson/podcast content to the app document directory. */
export async function saveLessonFile(lesson: ExportableLesson): Promise<string> {
  const dir = new Directory(Paths.document, 'exports');
  dir.create({ intermediates: true, idempotent: true });

  const file = new File(dir, `${sanitizeFileName(lesson.title)}.md`);
  file.write(buildTranscriptMarkdown(lesson));
  return file.uri;
}

/**
 * Save the file and hand it to the OS share sheet. Returns the saved file URI.
 * The same helper can share a real audio file later by pointing at its URI.
 */
export async function shareLessonFile(lesson: ExportableLesson): Promise<string> {
  const uri = await saveLessonFile(lesson);
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, {
    mimeType: 'text/markdown',
    dialogTitle: 'Export Study Studio content',
    UTI: 'net.daringfireball.markdown',
  });
  return uri;
}
