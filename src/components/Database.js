import { createRxDatabase, addRxPlugin } from 'rxdb';
import { getRxStoragePouch, addPouchPlugin, checkAdapter } from 'rxdb/plugins/pouchdb';
import { todoSchema } from './Schema';

// import RxDBSchemaCheckModule from 'rxdb/plugins/schema-check';
// import RxDBErrorMessagesModule from 'rxdb/plugins/error-messages';
import { RxDBValidatePlugin } from 'rxdb/plugins/validate';
import { RxDBReplicationGraphQLPlugin } from 'rxdb/plugins/replication-graphql';

import { createClient } from 'graphql-ws';

// addRxPlugin(RxDBSchemaCheckModule);
// addRxPlugin(RxDBErrorMessagesModule);
addRxPlugin(RxDBValidatePlugin);
addRxPlugin(RxDBReplicationGraphQLPlugin);

addPouchPlugin(require('pouchdb-adapter-idb'));

export const createDb = async () => {
    console.log('DatabaseService: creating database..');

    const db = await createRxDatabase({
        name: 'tododb',
        storage: getRxStoragePouch('idb'),
    });

    const ok = await checkAdapter('idb');
    console.dir(ok);

    console.log('DatabaseService: created database')

    await db.addCollections({
        name: 'todos',
        schema: todoSchema
     })
    return db;
};



const syncURL = 'https://becoming-muskrat-71.hasura.app/v1/graphql';

const batchSize = 5;
const pullQueryBuilder = (userId) => {
    return (doc) => {
        if (!doc) {
            doc = {
                id: '',
                updatedAt: new Date(0).toUTCString()
            };
        }

        const query = `{
            todos(
                where: {
                    _or: [
                        {updatedAt: {_gt: "${doc.updatedAt}"}},
                        {
                            updatedAt: {_eq: "${doc.updatedAt}"},
                            id: {_gt: "${doc.id}"}
                        }
                    ],
                    userId: {_eq: "${userId}"} 
                },
                limit: ${batchSize},
                order_by: [{updatedAt: asc}, {id: asc}]
            ) {
                id
                text
                isCompleted
                deleted
                createdAt
                updatedAt
                userId
            }
        }`;
        return {
            query,
            variables: {}
        };
    };
};

const pushQueryBuilder = doc => {
    const query = `
        mutation InsertTodo($todo: [todos_insert_input!]!) {
            insert_todos(
                objects: $todo,
                on_conflict: {
                    constraint: todos_pkey,
                    update_columns: [text, isCompleted, deleted, updatedAt]
                }){
                returning {
                  id
                }
              }
       }
    `;
    const variables = {
        todo: doc
    };

    return {
        query,
        variables
    };
};

export class GraphQLReplicator {
    constructor(db) {
        this.db = db;
        this.replicationState = null;
        this.createClient = null;      
    }

    async restart(auth) {
        if(this.replicationState) {
            this.replicationState.cancel()
        }

        if(this.createClient) {
            this.createClient.close()
        }

        this.replicationState = await this.setupGraphQLReplication(auth)
        this.createClient = this.setupGraphQLSubscription(auth, this.replicationState)
    }

    async setupGraphQLReplication(auth) {
        const replicationState = this.db.todos.syncGraphQL({
           url: syncURL,
           headers: {
               'Authorization': `Bearer ${auth.idToken}`
           },
           push: {
               batchSize,
               queryBuilder: pushQueryBuilder
           },
           pull: {
               queryBuilder: pullQueryBuilder(auth.userId)
           },
           live: true,
          
           liveInterval: 1000 * 60 * 10, 
           deletedFlag: 'deleted'
       });
   
       replicationState.error$.subscribe(err => {
           console.error('replication error:');
           console.dir(err);
       });

       return replicationState;
    }
   
    setupGraphQLSubscription(auth, replicationState) {
        const endpointUrl = 'wss:https://becoming-muskrat-71.hasura.app/v1/graphql';
        const wsClient = new createClient(endpointUrl, {
            reconnect: true,
            connectionParams: {
                headers: {
                    'Authorization': `Bearer ${auth.idToken}`
                }
            },
            timeout: 1000 * 60,
            onConnect: () => {
                console.log('createClient.onConnect()');
            },
            connectionCallback: () => {
                console.log('createClient.connectionCallback:');
            },
            reconnectionAttempts: 10000,
            inactivityTimeout: 10 * 1000,
            lazy: true
        });
    
        const query = `subscription onTodoChanged {
            todos {
                id
                deleted
                isCompleted
                text
            }       
        }`;
    
        const ret = wsClient.request({ query });
    
        ret.subscribe({
            next(data) {
                console.log('subscription emitted => trigger run');
                console.dir(data);
                replicationState.run();
            },
            error(error) {
                console.log('got error:');
                console.dir(error);
            }
        });
    
        return wsClient
    }    
}