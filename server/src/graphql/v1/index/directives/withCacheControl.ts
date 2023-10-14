// import fs from 'fs';
import crypto from 'crypto';

import { getDirective } from '@graphql-tools/utils';
import type { GraphQLSchema, GraphQLFieldConfig } from 'graphql';
import { defaultFieldResolver } from 'graphql';

import Keyv from '../../../../libs/Keyv';
import type { CacheControlScope } from '../types';
import type { GraphqlContextV1 } from '../../../../libs/Graphql';

const keyv = Keyv.getInstance();

function withCacheControl(
  fieldConfig: GraphQLFieldConfig<unknown, GraphqlContextV1, unknown>,
  directiveName: string,
  schema: GraphQLSchema,
) {
  {
    const directive = getDirective(schema, fieldConfig, directiveName)?.[0];

    if (directive) {
      const { resolve = defaultFieldResolver } = fieldConfig;

      fieldConfig.resolve = async function (
        parent,
        args,
        context: GraphqlContextV1,
        info,
      ) {
        if (info.path.typename !== 'Query') {
          throw new Error(
            `@${withCacheControl.name} can only be used with 'Query' parent type`,
          );
        }

        try {
          // fs.writeFileSync('./info.json', JSON.stringify(info), 'utf-8');

          const withAccessTokenVerification =
            context?.directives?.withAccessTokenVerification;

          const userSessionKey =
            withAccessTokenVerification?.credential?.session_key;
          const scope = (directive['scope'] ?? 'PRIVATE') as CacheControlScope;

          if (scope === 'PRIVATE' && userSessionKey == null) {
            return resolve(parent, args, context, info);
          }

          const returnType = info?.returnType;

          const hash = crypto
            .createHash('sha256')
            .update(JSON.stringify(info))
            .digest('hex');

          const cacheKey = `${returnType}${
            !(userSessionKey == null) ? `|${userSessionKey}` : ''
          }|${hash}`;

          const cacheValue = await keyv.get(cacheKey);
          if (!(cacheValue == null)) {
            console.log('--CACHE HIT---');
            return JSON.parse(cacheValue);
          }

          const result = await resolve(parent, args, context, info);
          const maxAge = (directive['maxAge'] ?? 500 * 1000) as number;
          await keyv.set(cacheKey, JSON.stringify(result), maxAge);

          return result;
        } catch (_) {
          console.log('---LOG CACHE ERROR---', _);
          return resolve(parent, args, context, info);
        }
      };
      return fieldConfig;
    }
  }
}

export default withCacheControl;
