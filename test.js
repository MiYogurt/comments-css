const css = require('./index');

const { print, stringify } = require('q-i');



var obj = css.parse(`
@supports (display: flex) {
    div {
        display: flex;
    }
}
`);

var result = css.stringify(obj, { sourcemap: true });

print(obj);

print(result);
