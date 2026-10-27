import type {TimetableCourse} from '../../shared/timetable'

const colors = new Map<string, string>()
const eventColors = new Map<string, string>()

export function courseColor(course: Pick<TimetableCourse, 'name' | 'teachers'>): string {
    const key = JSON.stringify([course.name, [...course.teachers].sort()])
    const existing = colors.get(key)
    if (existing) return existing

    const color = randomSoftHex()
    colors.set(key, color)
    return color
}

export function calendarEventColor(id: string): string {
    const existing = eventColors.get(id)
    if (existing) return existing

    const color = randomSoftHex()
    eventColors.set(id, color)
    return color
}

function randomSoftHex(): string {
    const hue = Math.floor(Math.random() * 360)
    const saturation = Math.floor(Math.random() * 21) + 20
    return pastelColor(hue, saturation)
}

function pastelColor(hue: number, saturation: number): string {
    const chroma = saturation / 100
    const intermediate = chroma * (1 - Math.abs((hue / 60) % 2 - 1))
    const minimum = 1 - chroma
    const sectors = [
        [chroma, intermediate, 0], [intermediate, chroma, 0],
        [0, chroma, intermediate], [0, intermediate, chroma],
        [intermediate, 0, chroma], [chroma, 0, intermediate],
    ]
    return `#${sectors[Math.floor(hue / 60)]
        .map(value => Math.round((value + minimum) * 255).toString(16).padStart(2, '0')).join('')}`
}
