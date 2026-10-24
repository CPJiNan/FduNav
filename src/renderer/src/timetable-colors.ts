import type {TimetableCourse} from '../../shared/timetable'

const colors = new Map<string, string>()

export function courseColor(course: Pick<TimetableCourse, 'name' | 'teachers'>): string {
    const key = JSON.stringify([course.name, [...course.teachers].sort()])
    const existing = colors.get(key)
    if (existing) return existing

    // Match one endpoint of index.vue's randomColorPair: H 0–359, S 20–40, B 100.
    const hue = Math.floor(Math.random() * 360)
    const saturation = Math.floor(Math.random() * 21) + 20
    const chroma = saturation / 100
    const intermediate = chroma * (1 - Math.abs((hue / 60) % 2 - 1))
    const minimum = 1 - chroma
    const sectors = [
        [chroma, intermediate, 0], [intermediate, chroma, 0],
        [0, chroma, intermediate], [0, intermediate, chroma],
        [intermediate, 0, chroma], [chroma, 0, intermediate],
    ]
    const color = '#' + sectors[Math.floor(hue / 60)]
        .map(value => Math.round((value + minimum) * 255).toString(16).padStart(2, '0')).join('')
    colors.set(key, color)
    return color
}
