check:
    npm test
    npm run build

test-browser:
    npm run test:browser

sandbox name='helixium' agent='codex' template='':
    python3 scripts/sandbox.py create {{name}} --agent {{agent}} --template '{{template}}'

sandbox-exec name +command:
    python3 scripts/sandbox.py exec {{name}} -- {{command}}

sandbox-attach name='helixium':
    python3 scripts/sandbox.py attach {{name}}

sandbox-export name='helixium':
    python3 scripts/sandbox.py export {{name}}

sandbox-remove name='helixium':
    python3 scripts/sandbox.py remove {{name}}
