export function filterNoticeTags(tags: string[]): string[] {
    return tags.filter(tag => !tag.includes('复旦大学'))
}
