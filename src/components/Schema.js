export const todoSchema  = {
    'version': 0,
    'title': 'todo schema',
    'description': 'todo schema',
    'type': 'object',
    'properties': {
        'id': {
            'type': 'string',
            'primary': true
        },
        'text': {
            'type': 'string'
        },
        'isCompleted': {
            'type': 'boolean'
        },
        'createdAt': {
            'type': 'string',
            'format': 'date-time',
            'index': true,        
        },
        'updatedAt': {
            'type': 'string',
            'format': 'date-time'
        },
        'userId': {
            'type': 'string'
        },
    },
    'required': ['text', 'isCompleted', 'userId', 'createdAt'],
    additionalProperties: true
};
