(function() {

zeit.cms.declare_namespace('zeit.edit');

// Lock to hold for asynchronous tasks.
zeit.edit.json_request_lock = new MochiKit.Async.DeferredLock();

zeit.edit.with_lock = function(callable) {
    var d = zeit.edit.json_request_lock.acquire()
    var pfunc = MochiKit.Base.partial.apply(
        MochiKit.Base, MochiKit.Base.extend(null, arguments));
    d.addCallback(function(result) {
        return pfunc();
    });
    d.addBoth(function(result_or_error) {
        zeit.edit.json_request_lock.release()
        return result_or_error;
    });
    return d;
}


zeit.edit.Editor = gocept.Class.extend({

    __name__: 'zeit.edit.Editor',

    construct: function() {
        var self = this;
        self.content = $('cp-content');
        self.inner_content = null;
        self.content.__handler__ = self;
        self.busy = false;
        MochiKit.Signal.connect(
            'content', 'onclick',
            self, self.handleContentClick);
        MochiKit.Signal.connect(
            self, 'reload', self, self.reload);
        new zeit.cms.ToolTipManager(self.content);
    },

    handleContentClick: function(event) {
        var self = this;
        var target = event.target();
        log("Target " + target.nodeName);
        while (!isNull(target) && target.id != 'content') {
            // Target can be null when it was removed from the DOM by a
            // previous event handler (like the lightbox shade)
            var module_name = target.getAttribute('cms:cp-module')
            if (!isNull(module_name)) {
                break;
            }
            target = target.parentNode;
        }
        if (module_name) {
            log("Loading module " + module_name);
            event.stop();
            var module = zeit.cms.resolveDottedName(module_name);
            new module(target);
        } else if (event.target().nodeName == 'A' && event.target().target) {
            // pass
        } else if (event.target().nodeName == 'A') {
            event.preventDefault();
        }
    },

    reload: function(element_id, url) {
        var self = this;
        log("Reloading", element_id, url);
        var element = null;
        if (!isUndefinedOrNull(element_id)) {
             element = $(element_id);
        }
        MochiKit.Signal.signal(self, 'before-reload');
        if (isUndefinedOrNull(url)) {
            url = context_url + '/contents';
        }
        var d = zeit.edit.with_lock(
            MochiKit.Async.doSimpleXMLHttpRequest, url);
        if (isNull(element)) {
            d.addCallback(function(result) {
                return self.replace_whole_editor(result);
            });
        } else {
            d.addCallback(function(result) {
                return self.replace_element(element, result);
            });
        }
        d.addCallback(function(result) {
            // Result: replaced element
            var loading = [];
            MochiKit.Iter.forEach(
                MochiKit.DOM.getElementsByTagAndClassName(
                    'SCRIPT', null, result),
                function(script) {
                    loading.push(zeit.cms.import(script.src));
                });
            var dl = new MochiKit.Async.DeferredList(loading);
            return dl;
        });
        d.addCallback(function(result) {
            MochiKit.Signal.signal(self, 'after-reload');
            return result;
        });
        d.addErrback(function(error) {
            zeit.cms.log_error(error);
            return error
        });
        return d;
    },

    replace_whole_editor: function(result) {
        var self = this;
        if (isNull(self.inner_content)) {
            self.content.innerHTML = result.responseText;
            self.inner_content = (
                MochiKit.DOM.getFirstElementByTagAndClassName(
                    'div', 'cp-content-inner', self.content));
        } else {
            var dom = DIV();
            dom.innerHTML = result.responseText;
            var new_inner = (
                MochiKit.DOM.getFirstElementByTagAndClassName(
                    'div', 'cp-content-inner', dom));
            self.inner_content.innerHTML = new_inner.innerHTML;
        }
        if (isUndefinedOrNull(self.inner_content)) {
            throw Error("Invalid editor content.");
        }
        return self.inner_content
    },

    replace_element: function(element, result) {
        var self = this;
        var dom = DIV();
        dom.innerHTML = result.responseText;
        MochiKit.DOM.swapDOM(element, dom.firstChild);
        return element // XXX
    },

    busy_until_reload_of: function(component, delay) {
        var self = this;
        if (self.busy) {
            // Already busy
            return;
        }
        log("Entering BUSY state " + component.__name__);
        self.busy = true;
        MochiKit.Signal.signal(self, 'busy', delay);
        var ident = MochiKit.Signal.connect(
            component, 'after-reload', function() {
                MochiKit.Signal.disconnect(ident);
                self.idle();
        });
    },

    idle: function() {
        var self = this;
        log("Entering IDLE state");
        if (self.busy) {
            self.busy = false;
            MochiKit.Signal.signal(self, 'idle');
        }
    },
});




(function() {
    var ident = MochiKit.Signal.connect(window, 'onload', function() {
        MochiKit.Signal.disconnect(ident);
        if (isNull($('cp-content'))) {
            return
        }
        // There is only one instance per page. Put it under a well known
        // location
        zeit.edit.editor = new zeit.edit.Editor();
        MochiKit.Signal.signal(window, 'cp-editor-initialized');
        zeit.edit.editor.busy_until_reload_of(
            zeit.edit.editor, 0);
        var d = zeit.edit.editor.reload();
        d.addCallback(function(result) {
            MochiKit.Signal.signal(window, 'cp-editor-loaded');
            return result;
        });
    });
})();


zeit.edit.BusyIndicator = gocept.Class.extend({

    construct: function() {
        var self = this;
        MochiKit.Signal.connect(
            zeit.edit.editor, 'busy', self, self.busy_after_a_while)
        MochiKit.Signal.connect(
            zeit.edit.editor, 'idle', self, self.idle)
        self.delayer = null; 
        self.indicator = DIV({
            class: 'hidden',
            id: 'busy-indicator'},
            DIV({class: 'shade'}),
            IMG({src: application_url + '/@@/zeit.imp/loading.gif'})
            );
        $('content').appendChild(self.indicator);
    },

    busy_after_a_while: function(delay) {
        var self = this;
        if (isUndefinedOrNull(delay)) {
            delay = 1;
        }
        self.delayer = MochiKit.Async.callLater(delay, function() {
            self.busy();
        });
    },

    busy: function() {
        var self = this;
        MochiKit.Style.setOpacity(self.indicator, 0);
        MochiKit.DOM.removeElementClass(self.indicator, 'hidden');
        MochiKit.Visual.appear(self.indicator);
    },

    idle: function() {
        var self = this;
        if (!isNull(self.delayer)) {
            self.delayer.cancel();
            self.delayer = null;
        }
        MochiKit.DOM.addElementClass(self.indicator, 'hidden');
    },

});


(function() {
    var ident = MochiKit.Signal.connect(
        window, 'cp-editor-initialized',
        function() {
            MochiKit.Signal.disconnect(ident);
            zeit.edit.busy_indicator = new zeit.edit.BusyIndicator();
        });
})();


})();
