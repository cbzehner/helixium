check:
    npm test
    python3 -m unittest discover -s tests -p '*_test.py'
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

macos-create name='helixium-safari':
    python3 scripts/macos-sandbox.py create {{name}}

macos-start name='helixium-safari':
    python3 scripts/macos-sandbox.py start {{name}}

macos-seed name='helixium-safari':
    python3 scripts/macos-sandbox.py seed {{name}}

macos-exec name +command:
    python3 scripts/macos-sandbox.py exec {{name}} -- {{command}}

macos-export name='helixium-safari':
    python3 scripts/macos-sandbox.py export {{name}}

macos-remove name='helixium-safari':
    python3 scripts/macos-sandbox.py remove {{name}}

test-chrome:
    HELIXIUM_CHROME=1 npm run test:browser

test-safari:
    npm run test:safari
