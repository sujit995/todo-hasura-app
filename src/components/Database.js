import { createRxDatabase, addRxPlugin } from 'rxdb';
import { getRxStoragePouch, addPouchPlugin, checkAdapter } from 'rxdb/plugins/pouchdb';
import { todoSchema } from './Schema';

// import RxDBSchemaCheckModule from 'rxdb/plugins/schema-check';
// import RxDBErrorMessagesModule from 'rxdb/plugins/error-messages';
import { RxDBValidatePlugin } from 'rxdb/plugins/validate';
import { RxDBReplicationGraphQLPlugin } from 'rxdb/plugins/replication-graphql';

import { SubscriptionClient } from 'subscriptions-transport-ws';
// import { createClient } from 'graphql-ws';

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
        ignoreDuplicate: true
    });

    const ok = await checkAdapter('idb');
    console.dir(ok);

    console.log('DatabaseService: created database')
    console.log(todoSchema)

    await db.addCollections({
        todos: {
            schema: todoSchema,
            migrationStrategies: {
                1: (oldDoc) => {
                    return oldDoc
                }
            }
        }

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
        this.subscriptionClient = null;  
    }

    async restart(auth) {
        if(this.replicationState) {
            this.replicationState.cancel()
            console.log(this.replicationState.cancel())
        }

        if(this.subscriptionClient) {
            this.subscriptionClient.close()
            console.log(this.replicationState.cancel())
        }

        this.replicationState = await this.setupGraphQLReplication(auth)
        this.subscriptionClient = this.setupGraphQLSubscription(auth, this.replicationState)
    }

    async setupGraphQLReplication(auth) {
        const replicationState = this.db.todos.syncGraphQL({
           url: syncURL,
        //    headers: {
        //        'Authorization': `Bearer ${auth.idToken}`
        //    },
           push: {
               batchSize,
               queryBuilder: pushQueryBuilder
           },
           pull: {
               queryBuilder: pullQueryBuilder(auth.userId)
           },
           live: true,
           /**
            * Because the websocket is used to inform the client
            * when something has changed,
            * we can set the liveIntervall to a high value
            */
           liveInterval: 1000 * 60 * 10, // 10 minutes
           deletedFlag: 'deleted'
       });
   
       replicationState.error$.subscribe(err => {
           console.error('replication error:');
           console.dir(err);
       });

       return replicationState;
    }
   
    setupGraphQLSubscription(auth, replicationState) {
        // Change this url to point to your hasura graphql url
        const endpointURL = 'ws://becoming-muskrat-71.hasura.app/v1/graphql';
        const wsClient = new SubscriptionClient(endpointURL, {
            reconnect: true,
            connectionParams: {
                headers: {
                    'Authorization': `Bearer ${auth.idToken}`
                }
            },
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