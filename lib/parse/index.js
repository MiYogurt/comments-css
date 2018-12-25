// http://www.w3.org/TR/CSS21/grammar.html
// https://github.com/visionmedia/css-parse/pull/49#issuecomment-30088027
var commentre = /\/\*[^*]*\*+([^/*][^*]*\*+)*\//g

module.exports = function(css, options){
  options = options || {};

  /**
   * Positional.
   */
  // 全局的位置信息
  var lineno = 1; // 行
  var column = 1; // 列

  /**
   * Update lineno and column based on `str`.
   */

  function updatePosition(str) {
    var lines = str.match(/\n/g);
    if (lines) lineno += lines.length;
    var i = str.lastIndexOf('\n');
    column = ~i ? str.length - i : column + str.length;
  }

  /**
   * Mark position and patch `node.position`.
   */

  function position() {
    var start = { line: lineno, column: column };
    return function(node){
      node.position = new Position(start);
      whitespace();
      return node;
    };
  }

  /**
   * Store position information for a node
   */

  function Position(start) {
    this.start = start;
    this.end = { line: lineno, column: column };
    this.source = options.source;
  }

  /**
   * Non-enumerable source string
   */

  Position.prototype.content = css;

  /**
   * Error `msg`.
   */

  var errorsList = [];

  function error(msg) {
    var err = new Error(options.source + ':' + lineno + ':' + column + ': ' + msg);
    err.reason = msg;
    err.filename = options.source;
    err.line = lineno;
    err.column = column;
    err.source = css;

    if (options.silent) {
      errorsList.push(err);
    } else {
      throw err;
    }
  }

  /**
   * Parse stylesheet.
   */
  // 根入口
  function stylesheet() {
    var rulesList = rules();

    return {
      type: 'stylesheet',
      stylesheet: {
        source: options.source,
        rules: rulesList,
        parsingErrors: errorsList
      }
    };
  }

  /**
   * Opening brace.
   */

  function open() {
    return match(/^{\s*/);
  }

  /**
   * Closing brace.
   */

  function close() {
    return match(/^}/);
  }

  /**
   * Parse ruleset.
   */
  // 解析规则
  function rules() {
    var node;
    var rules = [];
    whitespace();
    comments(rules);
    while (css.length && css.charAt(0) != '}' && (node = atrule() || rule())) {
      if (node !== false) {
        rules.push(node);
        comments(rules);
      }
    }
    return rules;
  }

  /**
   * Match `re` and return captures.
   */

  function match(re) {
    var m = re.exec(css);
    if (!m) return;
    var str = m[0];
    updatePosition(str);
    css = css.slice(str.length);
    return m;
  }

  /**
   * Parse whitespace.
   */

  function whitespace() {
    match(/^\s*/);
  }

  /**
   * Parse comments;
   */
  // 解析连续的 comments
  function comments(rules) {
    var c;
    rules = rules || [];
    while (c = comment()) {
      if (c !== false) {
        rules.push(c);
      }
    }
    return rules;
  }

  /**
   * Parse comment.
   */
  // 处理注释代码
  function comment() {
    // 得到 pos 方法，缓存开始的定位，这是一个函数，给函数传递 node 节点，将记录 end 完善 postion 位置信息
    var pos = position();
    // 开始必须是 /* 不是则代表不符合规则，则退出
    if ('/' != css.charAt(0) || '*' != css.charAt(1)) return;

    var i = 2;
    // 通过 i 记录 comment 的的长度， 遇到 */ 则停止加减
    while ("" != css.charAt(i) && ('*' != css.charAt(i) || '/' != css.charAt(i + 1))) ++i;
    
    // 加上最后的 */ 2个字符
    i += 2;

    // 假如最后一为不是 / ，说明 comment 语法有错误
    if ("" === css.charAt(i-1)) {
      return error('End of comment missing');
    }


    // 去掉 /* 和 */ 将之前的内容截取出来。
    var str = css.slice(2, i - 2);
    
    // column 是横向的， /* 是 2 位，所以要加 2 位
    column += 2;
    updatePosition(str); // 然后处理注释内容的位置信息
    css = css.slice(i); // 将注释内容提取出来，这里是包括 /* 和 */ 的
    column += 2; // 2 代表最后的 2位 */

    // 传入 node 节点信息，通过 pos 方法附着位置信息
    return pos({
      type: 'comment',
      comment: str
    });
  }

  /**
   * Parse selector.
   */
  // 解析选择器
  function selector() {
    var m = match(/^([^{]+)/);
    if (!m) return;
    /* @fix Remove all comments from selectors
     * http://ostermiller.org/findcomment.html */
    return trim(m[0])
      // 去掉注释的内容
      .replace(/\/\*([^*]|[\r\n]|(\*+([^*/]|[\r\n])))*\*\/+/g, '')
      // 将引号里面的内容 “ 或者 ‘ 的 ， 替换为 \u200C ， \u200C 是无意义的零宽字符
      .replace(/"(?:\\"|[^"])*"|'(?:\\'|[^'])*'/g, function(m) {
        return m.replace(/,/g, '\u200C');
      })
      // 使用不是 （）的 ，分割选择器
      .split(/\s*(?![^(]*\)),\s*/)
      .map(function(s) {
        // 将之前的零宽字符恢复
        return s.replace(/\u200C/g, ',');
      });
  }

  /**
   * Parse declaration.
   */
  // 解析定义
  function declaration() {
    // 缓存开始位置
    var pos = position();
    
    // prop
    // 将 css 的属性名提取出来
    var prop = match(/^(\*?[-#\/\*\\\w]+(\[[0-9a-z_-]+\])?)\s*/);
    
    if (!prop) return;
    prop = trim(prop[0]);
    
    // :
    if (!match(/^:\s*/)) return error("property missing ':'");

    // val
    // 将 css 的值提取出来
    var val = match(/^((?:'(?:\\'|.)*?'|"(?:\\"|.)*?"|\([^\)]*?\)|[^};])+)/);

    // 将剔除出来的值进行组合
    var ret = pos({
      type: 'declaration',
      property: prop.replace(commentre, ''),
      value: val ? trim(val[0]).replace(commentre, '') : ''
    });

    // ;
    // 剔除无用的 ；
    match(/^[;\s]*/);

    return ret;
  }

  /**
   * Parse declarations.
   */
  /**
   * 解析定义数组，处理数组的方式非常简单，只要可以处理单个就一直处理下去
   */
  function declarations() {
    var decls = [];
    
    // open 去掉 {
    if (!open()) return error("missing '{'");
    
    // 去掉注释
    comments(decls);

    // declarations
    var decl;
    // 只要解析成功，就一直解析下去。
    while (decl = declaration()) {
      if (decl !== false) {
        decls.push(decl);
        comments(decls);
      }
    }
    
    // close 会去掉末尾的 } 
    if (!close()) return error("missing '}'");
    
    return decls;
  }

  /**
   * Parse keyframe.
   */
  // 解析动画帧 keyframe
  function keyframe() {
    var m;
    var vals = [];
    // 记录开始
    var pos = position();
    // m 为 keyframe 里面进度的名字
    /*
      {
        from {top:0px;}
        to {top:200px;}
      }
      分别是 from 和 to
      这里只是处理单次的 from {top:0px;}
     */
    while (m = match(/^((\d+\.\d+|\.\d+|\d+)%?|[a-z]+)\s*/)) {
      vals.push(m[1]);
      match(/^,\s*/);
    }

    if (!vals.length) return;
    
    return pos({
      type: 'keyframe',
      values: vals,
      declarations: declarations()
    });
  }

  /**
   * Parse keyframes.
   */

  function atkeyframes() {
    var pos = position();
    // \w 是为了匹配浏览器前缀，匹配关键字 @keyframes
    var m = match(/^@([-\w]+)?keyframes\s*/);

    if (!m) return;
    console.log(m);
    // vendor 为浏览器前缀
    var vendor = m[1];

    // identifier 匹配 @keyframes 之后的关键字
    var m = match(/^([-\w]+)\s*/);
    
    if (!m) return error("@keyframes missing name");
    var name = m[1];

    // 打开 {
    if (!open()) return error("@keyframes missing '{'");

    var frame;
    // 先解析开始的注释
    var frames = comments();
    while (frame = keyframe()) {
      frames.push(frame);
      // 解析 frame 之间的注释
      frames = frames.concat(comments());
    }

    // 关闭解析 }
    if (!close()) return error("@keyframes missing '}'");

    return pos({
      type: 'keyframes',
      name: name,
      vendor: vendor,
      keyframes: frames
    });
  }

  /**
   * Parse supports.
   */
  // 解析 @supports 指令
  function atsupports() {
    var pos = position();
    var m = match(/^@supports *([^{]+)/);

    if (!m) return;

    // supports 的判断条件提取
    var supports = trim(m[1]);
    
    // 打开 {
    if (!open()) return error("@supports missing '{'");
    
    // 解析注释和规则
    var style = comments().concat(rules());
    
    // 关闭 }
    if (!close()) return error("@supports missing '}'");

    return pos({
      type: 'supports',
      supports: supports,
      rules: style
    });
  }

  /**
   * Parse host.
   */

  function athost() {
    var pos = position();
    var m = match(/^@host\s*/);

    if (!m) return;

    if (!open()) return error("@host missing '{'");

    var style = comments().concat(rules());

    if (!close()) return error("@host missing '}'");

    return pos({
      type: 'host',
      rules: style
    });
  }

  /**
   * Parse media.
   */

  function atmedia() {
    var pos = position();
    var m = match(/^@media *([^{]+)/);

    if (!m) return;
    var media = trim(m[1]);

    if (!open()) return error("@media missing '{'");

    var style = comments().concat(rules());

    if (!close()) return error("@media missing '}'");

    return pos({
      type: 'media',
      media: media,
      rules: style
    });
  }


  /**
   * Parse custom-media.
   */

  function atcustommedia() {
    var pos = position();
    var m = match(/^@custom-media\s+(--[^\s]+)\s*([^{;]+);/);
    if (!m) return;

    return pos({
      type: 'custom-media',
      name: trim(m[1]),
      media: trim(m[2])
    });
  }

  /**
   * Parse paged media.
   */

  function atpage() {
    var pos = position();
    var m = match(/^@page */);
    if (!m) return;

    var sel = selector() || [];

    if (!open()) return error("@page missing '{'");
    var decls = comments();

    // declarations
    var decl;
    while (decl = declaration()) {
      decls.push(decl);
      decls = decls.concat(comments());
    }

    if (!close()) return error("@page missing '}'");

    return pos({
      type: 'page',
      selectors: sel,
      declarations: decls
    });
  }

  /**
   * Parse document.
   */

  function atdocument() {
    var pos = position();
    var m = match(/^@([-\w]+)?document *([^{]+)/);
    if (!m) return;

    var vendor = trim(m[1]);
    var doc = trim(m[2]);

    if (!open()) return error("@document missing '{'");

    var style = comments().concat(rules());

    if (!close()) return error("@document missing '}'");

    return pos({
      type: 'document',
      document: doc,
      vendor: vendor,
      rules: style
    });
  }

  /**
   * Parse font-face.
   */

  function atfontface() {
    var pos = position();
    var m = match(/^@font-face\s*/);
    if (!m) return;

    if (!open()) return error("@font-face missing '{'");
    var decls = comments();

    // declarations
    var decl;
    while (decl = declaration()) {
      decls.push(decl);
      decls = decls.concat(comments());
    }

    if (!close()) return error("@font-face missing '}'");

    return pos({
      type: 'font-face',
      declarations: decls
    });
  }

  /**
   * Parse import
   */

  var atimport = _compileAtrule('import');

  /**
   * Parse charset
   */

  var atcharset = _compileAtrule('charset');

  /**
   * Parse namespace
   */

  var atnamespace = _compileAtrule('namespace');

  /**
   * Parse non-block at-rules
   */

  // 将公共的逻辑抽离出来
  function _compileAtrule(name) {
    var re = new RegExp('^@' + name + '\\s*([^;]+);');
    return function() {
      var pos = position();
      var m = match(re);
      if (!m) return;
      var ret = { type: name };
      ret[name] = m[1].trim();
      return pos(ret);
    }
  }

  /**
   * Parse at rule.
   */
  // 将 at 的规则综合起来
  function atrule() {
    if (css[0] != '@') return;

    return atkeyframes()
      || atmedia()
      || atcustommedia()
      || atsupports()
      || atimport()
      || atcharset()
      || atnamespace()
      || atdocument()
      || atpage()
      || athost()
      || atfontface();
  }

  /**
   * Parse rule.
   */
  // 解析 rule
  function rule() {
    var pos = position();
    // 解析选择器
    var sel = selector();

    if (!sel) return error('selector missing');
    comments();

    return pos({
      type: 'rule',
      selectors: sel,
      declarations: declarations()
    });
  }


  // 入口点
  return addParent(stylesheet());
};

/**
 * Trim `str`.
 */

function trim(str) {
  return str ? str.replace(/^\s+|\s+$/g, '') : '';
}

/**
 * Adds non-enumerable parent node reference to each node.
 */
// 为子代添加 parent 引用
function addParent(obj, parent) {
  var isNode = obj && typeof obj.type === 'string';
  var childParent = isNode ? obj : parent;

  for (var k in obj) {
    var value = obj[k];
    if (Array.isArray(value)) {
      value.forEach(function(v) { addParent(v, childParent); });
    } else if (value && typeof value === 'object') {
      addParent(value, childParent);
    }
  }

  if (isNode) {
    Object.defineProperty(obj, 'parent', {
      configurable: true,
      writable: true,
      enumerable: false,
      value: parent || null
    });
  }

  return obj;
}
