export const todoSchema = {
    keyCompression: true,
    version: 1,
    title: 'todo schema',
    primaryKey: 'id',
    type: 'object',
    properties: {
        id: {
            type: 'string',
            primary: true
        },
        text: {
            type: 'string'
        },
        isCompleted: {
            type: 'boolean'
        },
        createdAt: {
            type: 'string',
            format: 'date-time',
        },
        updatedAt: {
            type: 'string',
            format: 'date-time'
        },
        userId: {
            type: 'string'
        },
        required: ['text', 'isCompleted', 'userId', 'createdAt'],
        indexes: ['createdAt'],
    }
}